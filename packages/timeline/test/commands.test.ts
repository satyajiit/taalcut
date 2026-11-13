// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M1 on core's real command bus: every edit is undoable and redoable, its
 * re-sync undone in the same step; agents can't touch locked clips; the music
 * choice and an own track's re-time (the reel's music: music-choice.test.ts);
 * a restore carries the caption track.
 */
import {
  createCommandBus,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  forwardCommandEvents,
  newId,
  ok,
  RationalTime,
  type BeatMap,
  type CaptionTrack,
  type CommandOrigin,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { createTimelineCommands } from '../src/commands/commands';
import type { TimelineCommandDeps } from '../src/commands/context';
import { makeProfile, unitVector } from './fixtures/library';
import { createMemoryTimelineStore } from './fixtures/store';
import { buildTimeline, clipById, starts } from './fixtures/timeline';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };
const agent: CommandOrigin = { source: 'agent', actor: 'agent:run' };
const f = (value: number) => RationalTime.of(value, { num: 30, den: 1 });

async function setup(locked = false, extra: Partial<TimelineCommandDeps> = {}) {
  const clock = createManualClock(1_000);
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  const events = createEventBus({ clock });
  forwardCommandEvents(bus, events);
  const changed: string[] = [];
  events.on('library.changed', (event) => changed.push(`${event.payload.change}:${event.payload.ids.join(',')}`));
  const store = createMemoryTimelineStore();
  const shot = makeProfile({ embedding: unitVector(1), frames: 300 });
  const commands = createTimelineCommands({
    store,
    events,
    clock,
    catalog: createMemoryShotCatalog([shot]),
    ...extra,
  });
  bus.register(...commands.all);
  commands.announce(bus);
  const built = buildTimeline({
    clips: [{ frames: 30 }, { frames: 30, locked }, { frames: 30 }],
    texts: [{ start: 0, frames: 10 }],
  });
  const created = await bus.dispatch('timeline.create', { projectId: built.timeline.projectId, timelines: [built.timeline] }, ui);
  if (!created.ok) throw new Error(created.error.code);
  const target = { projectId: built.timeline.projectId, timelineId: built.timeline.id };
  const read = () => store.docs.get(built.timeline.id) as Timeline;
  return { bus, store, built, target, read, shot, changed, clock };
}

/** The document without the fields every write bumps. */
const content = (timeline: Timeline) => ({ ...timeline, revision: 0, updatedAt: 0 });

describe('timeline commands on the bus', () => {
  it('creates in one step that one undo removes', async () => {
    const { bus, store, built, target, changed } = await setup();
    expect(store.docs.has(built.timeline.id)).toBe(true);
    expect(changed).toEqual([`created:${built.timeline.id}`]);
    await bus.undo(target.projectId, ui);
    expect(store.docs.has(built.timeline.id)).toBe(false);
    await bus.redo(target.projectId, ui);
    expect(content(store.docs.get(built.timeline.id)!)).toEqual(content(built.timeline));
  });

  it('undoes and redoes every edit exactly, re-sync included', async () => {
    const { bus, built, target, read, shot } = await setup();
    const { ids } = built;
    const track = built.timeline.tracks[1];
    const textId = track?.kind === 'text' ? track.items[0]!.id : '';
    const pick = {
      assetId: shot.assetId,
      shotId: shot.shotId,
      sourceStart: f(0),
      syncPoint: f(20),
      score: 0.9,
      parts: { intent: 0.9, motion: 1, quality: 0.8, subject: 0.5, energy: 0.9, hook: null, rerank: 0.95, penalty: 0 },
    };
    const edits: [string, Record<string, unknown>][] = [
      ['timeline.applyCast', { picks: [{ slotId: built.slots[1], pick }] }],
      ['timeline.swapClip', { clipId: ids[0], media: { assetId: shot.assetId, shotId: shot.shotId }, from: 'search' }],
      ['timeline.trimClip', { clipId: ids[1], edge: 'end', by: f(10) }],
      ['timeline.moveClip', { clipId: ids[0], toIndex: 2 }],
      ['timeline.editText', { itemId: textId, text: 'Day one' }],
      ['timeline.moveText', { itemId: textId, box: { x: 0.12, y: 0.25, width: 0.76, height: 0.15 } }],
      ['timeline.lockClip', { clipId: ids[2], locked: true }],
    ];
    for (const [name, payload] of edits) {
      const before = read();
      const done = await bus.dispatch(name, { ...target, ...payload }, ui);
      if (!done.ok) throw new Error(`${name}: ${done.error.code} ${done.error.detail ?? ''}`);
      const after = read();
      expect(after.revision, name).toBe(before.revision + 1);
      expect(content(after), name).not.toEqual(content(before));
      await bus.undo(target.projectId, ui);
      expect(content(read()), name).toEqual(content(before));
      await bus.redo(target.projectId, ui);
      expect(content(read()), name).toEqual(content(after));
    }
    // The trim's roll snapped to the beat, and one undo above took back both.
    expect(starts(read())).toEqual([0, 30, 75, 90]);
  });

  it('chooses an in-point that puts a motion peak on the clip anchor when swapping', async () => {
    const { bus, target, read, built, shot } = await setup();
    const done = await bus.dispatch(
      'timeline.swapClip',
      { ...target, clipId: built.ids[1], media: { assetId: shot.assetId, shotId: shot.shotId }, from: 'search' },
      ui,
    );
    expect(done.ok).toBe(true);
    const clip = clipById(read(), built.ids[1]!);
    expect(clip.syncPoint).not.toBeNull();
    const offset = RationalTime.subtract(clip.syncPoint!, clip.sourceStart).value;
    expect(Math.abs(offset)).toBeLessThanOrEqual(1);
    expect(shot.motionPeakFrames).toContain(clip.syncPoint!.value);
  });

  it('refuses agent edits on locked clips, and person-only commands from people', async () => {
    const { bus, target, built, shot } = await setup(true);
    const swap = await bus.dispatch(
      'timeline.swapClip',
      { ...target, clipId: built.ids[1], media: { assetId: shot.assetId, shotId: shot.shotId }, from: 'agent' },
      agent,
    );
    expect(!swap.ok && swap.error.code).toBe('timeline.clip_locked');
    const restore = await bus.dispatch('timeline.restore', { ...target, markers: [] }, ui);
    expect(!restore.ok && restore.error.code).toBe('core.internal_command');
    const unknown = await bus.dispatch('timeline.lockClip', { ...target, timelineId: target.projectId, clipId: built.ids[0], locked: true }, ui);
    expect(!unknown.ok && unknown.error.code).toBe('timeline.not_found');
  });

  it('reports a revision race as core.conflict', async () => {
    const { bus, store, target, built } = await setup();
    const put = store.put.bind(store);
    store.put = async (timeline, expected) => put(timeline, expected - 1);
    const done = await bus.dispatch('timeline.lockClip', { ...target, clipId: built.ids[0], locked: true }, ui);
    expect(!done.ok && done.error.code).toBe('core.conflict');
  });

  it('answers swaps with core.not_implemented when no catalogue is wired', async () => {
    const clock = createManualClock(0);
    const store = createMemoryTimelineStore();
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
    bus.register(...createTimelineCommands({ store, events: createEventBus({ clock }), clock }).all);
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }] });
    await bus.dispatch('timeline.create', { projectId: timeline.projectId, timelines: [timeline] }, ui);
    const shot = makeProfile({ embedding: unitVector(2) });
    const swap = await bus.dispatch(
      'timeline.swapClip',
      { projectId: timeline.projectId, timelineId: timeline.id, clipId: ids[0], media: { assetId: shot.assetId, shotId: shot.shotId }, from: 'search' },
      ui,
    );
    expect(!swap.ok && swap.error.code).toBe('core.not_implemented');
  });
});

describe('music.choosePath', () => {
  const track = (assetId: string) => ({ path: 'ownTrack', assetId, offset: f(10), gainDb: -3 });
  const trackBeats: BeatMap = {
    rate: { num: 30, den: 1 },
    beats: [0, 10, 30, 50, 70, 90, 110].map(f),
    downbeats: [1, 5],
    bpm: 90,
    beatsPerBar: 4,
    confidence: 0.9,
    source: 'tracker',
  };

  it('re-times the cuts to the user’s own track; one undo puts back the choice and the cuts', async () => {
    const { bus, target, read } = await setup(false, { trackBeats: async () => ok(trackBeats) });
    const before = content(read());
    const chosen = await bus.dispatch('music.choosePath', { ...target, choice: track(target.timelineId) }, ui);
    expect(chosen.ok).toBe(true);
    expect(read().music).toEqual(track(target.timelineId));
    expect(read().beatMap).toMatchObject({ beats: [0, 20, 40, 60, 80, 100].map(f), downbeats: [0, 4] });
    expect(read().tracks).not.toEqual(before.tracks);
    await bus.undo(target.projectId, ui);
    expect(content(read())).toEqual(before);
  });

  it('keeps the cuts when the track has no beat map yet', async () => {
    const { bus, target, read } = await setup(false, { trackBeats: async () => ok(null) });
    const before = read();
    await bus.dispatch('music.choosePath', { ...target, choice: track(target.timelineId) }, ui);
    expect(read().tracks).toEqual(before.tracks);
    expect(read().beatMap).toEqual(before.beatMap);
    expect(read().music.path).toBe('ownTrack');
  });

  it('puts a caption track back with timeline.restore, undoably', async () => {
    const { bus, target, read } = await setup();
    const rate = { num: 30, den: 1 };
    const captions: CaptionTrack = {
      enabled: true,
      language: 'en',
      style: {
        version: 1,
        font: 'notoSans',
        weight: 700,
        sizePx: 64,
        textColor: '#ffffff',
        highlightColor: '#ffcc00',
        stroke: null,
        background: null,
        highlight: 'color',
        letterCase: 'asIs',
        anchorY: 0.7,
        maxLines: 2,
        maxWords: 4,
      },
      styleSource: 'preset',
      cues: [
        {
          id: newId<'CaptionCue'>(),
          range: { start: RationalTime.of(10, rate), duration: RationalTime.of(20, rate) },
          words: [{ text: 'hello', range: { start: RationalTime.of(10, rate), duration: RationalTime.of(10, rate) }, confidence: 1 }],
          edited: false,
        },
      ],
    };
    expect(read().captions).toBeNull();
    // Internal: undo and redo run it, never a person.
    const restored = await bus.dispatch('timeline.restore', { ...target, captions }, agent);
    if (!restored.ok) throw new Error(restored.error.code);
    expect(read().captions).toEqual(captions);
    await bus.undo(target.projectId, agent);
    expect(read().captions).toBeNull();
  });

  it('writes nothing when the choice is unchanged', async () => {
    const { bus, target, read } = await setup();
    const revision = read().revision;
    const same = await bus.dispatch('music.choosePath', { ...target, choice: { path: 'platformSound' } }, ui);
    expect(same.ok && same.value.undoable).toBe(false);
    expect(read().revision).toBe(revision);
  });
});

describe('timeline.create', () => {
  it('refuses a timeline from another project, and a ramp past its media', async () => {
    const { bus, target } = await setup();
    const other = buildTimeline({ clips: [{ frames: 30 }] }).timeline;
    const foreign = await bus.dispatch('timeline.create', { projectId: target.projectId, timelines: [other] }, ui);
    expect(!foreign.ok && foreign.error.code).toBe('core.validation');
    const ramped = buildTimeline({ clips: [{ frames: 60, media: 200, ramp: [[0, 3], [59, 3]] }] }).timeline;
    const tooFast = await bus.dispatch('timeline.create', { projectId: ramped.projectId, timelines: [ramped] }, ui);
    expect(!tooFast.ok && tooFast.error.code).toBe('timeline.invalid_move');
  });
});
