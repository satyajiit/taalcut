// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `music.choosePath` and the reel's own music since REF1: no acknowledgement, from any source; only the timeline's
 * own template's reel; and after an own track moved the cuts, choosing the reel puts them back on the reel's beats
 * (the template's beat map), one undo taking both back.
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
  type CommandOrigin,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTimelineCommands } from '../src/commands/commands';
import type { TimelineCommandDeps } from '../src/commands/context';
import { memoryTemplateReader } from '../src/service/templates';
import { createMemoryTimelineStore } from './fixtures/store';
import { buildTemplate } from './fixtures/template';
import { buildTimeline, starts } from './fixtures/timeline';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };
const agent: CommandOrigin = { source: 'agent', actor: 'agent:run' };
const f = (value: number) => RationalTime.of(value, { num: 30, den: 1 });
const reel = (templateId: string) => ({ path: 'referenceAudio', templateId, gainDb: 0 });
const track = (assetId: string) => ({ path: 'ownTrack', assetId, offset: f(10), gainDb: -3 });

/** An own track on another grid than the reel's: beats every 20 frames from 0, under the timeline from frame 0. */
const trackBeats: BeatMap = {
  rate: { num: 30, den: 1 },
  beats: [10, 30, 50, 70, 90, 110, 130].map(f),
  downbeats: [0],
  bpm: 90,
  beatsPerBar: 4,
  confidence: 0.9,
  source: 'tracker',
};

/** A timeline made from a template (on the template's beats), on the bus, with the deps a test adds. */
async function setup(extra: Partial<TimelineCommandDeps> = {}, fromTemplate = true) {
  const clock = createManualClock(1_000);
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  const events = createEventBus({ clock });
  forwardCommandEvents(bus, events);
  const store = createMemoryTimelineStore();
  const built = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
  const template = { ...buildTemplate({ slots: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] }), beatMap: built.timeline.beatMap };
  const timeline: Timeline = fromTemplate ? { ...built.timeline, template: { id: template.id, version: template.version } } : built.timeline;
  const commands = createTimelineCommands({ store, events, clock, templates: memoryTemplateReader([template]), ...extra });
  bus.register(...commands.all);
  commands.announce(bus);
  const created = await bus.dispatch('timeline.create', { projectId: timeline.projectId, timelines: [timeline] }, ui);
  if (!created.ok) throw new Error(created.error.code);
  const target = { projectId: timeline.projectId, timelineId: timeline.id };
  const read = () => store.docs.get(timeline.id) as Timeline;
  return { bus, target, read, template, timeline };
}

describe('music.choosePath: the reel’s own music', () => {
  it('needs no acknowledgement, from a person or the agent; one undo puts back the music before', async () => {
    const { bus, target, read, template } = await setup();
    const byUser = await bus.dispatch('music.choosePath', { ...target, choice: reel(template.id) }, ui);
    expect(byUser.ok).toBe(true);
    expect(read().music).toEqual(reel(template.id));
    await bus.undo(target.projectId, ui);
    expect(read().music).toEqual({ path: 'platformSound' });
    // An old window's `acknowledgedAt` is ignored, whoever sends it.
    const byAgent = await bus.dispatch('music.choosePath', { ...target, choice: reel(template.id), acknowledgedAt: 5 }, agent);
    expect(byAgent.ok).toBe(true);
    expect(read().music.path).toBe('referenceAudio');
  });

  it('writes only the music when the cuts are on the reel’s beats already', async () => {
    const { bus, target, read, template, timeline } = await setup();
    await bus.dispatch('music.choosePath', { ...target, choice: reel(template.id) }, ui);
    expect(read().tracks).toEqual(timeline.tracks);
    expect(read().beatMap).toEqual(timeline.beatMap);
  });

  it('refuses another template’s reel, and a reel on a timeline made without a template', async () => {
    const { bus, target, read } = await setup();
    const other = await bus.dispatch('music.choosePath', { ...target, choice: reel(newId<'Template'>()) }, ui);
    expect(!other.ok && other.error).toMatchObject({ code: 'core.validation', params: { field: 'choice.templateId' } });
    expect(read().music.path).toBe('platformSound');
    const plain = await setup({}, false);
    const none = await plain.bus.dispatch('music.choosePath', { ...plain.target, choice: reel(newId<'Template'>()) }, ui);
    expect(!none.ok && none.error.code).toBe('core.validation');
  });

  it('puts the cuts back on the reel’s beats after an own track moved them; one undo takes both back', async () => {
    const { bus, target, read, template, timeline } = await setup({ trackBeats: async () => ok(trackBeats) });
    await bus.dispatch('music.choosePath', { ...target, choice: track(newId<'Asset'>()) }, ui);
    const onTrack = read();
    expect(onTrack.beatMap).not.toEqual(timeline.beatMap);
    expect(starts(onTrack)).not.toEqual(starts(timeline));
    const chosen = await bus.dispatch('music.choosePath', { ...target, choice: reel(template.id) }, ui);
    expect(chosen.ok).toBe(true);
    expect(read().music).toEqual(reel(template.id));
    expect(read().beatMap).toEqual(template.beatMap);
    // Every cut back on a beat of the reel's grid.
    const grid = new Set(template.beatMap!.beats.map((beat) => beat.value));
    expect(starts(read()).every((start) => grid.has(start))).toBe(true);
    await bus.undo(target.projectId, ui);
    expect({ ...read(), revision: 0, updatedAt: 0 }).toEqual({ ...onTrack, revision: 0, updatedAt: 0 });
  });

  it('keeps the cuts when the template can’t be found: the choice stands, and the export says what is missing', async () => {
    const { bus, target, read, template } = await setup({
      trackBeats: async () => ok(trackBeats),
      templates: memoryTemplateReader([]),
    });
    await bus.dispatch('music.choosePath', { ...target, choice: track(newId<'Asset'>()) }, ui);
    const onTrack = read();
    const chosen = await bus.dispatch('music.choosePath', { ...target, choice: reel(template.id) }, ui);
    expect(chosen.ok).toBe(true);
    expect(read().tracks).toEqual(onTrack.tracks);
    expect(read().music.path).toBe('referenceAudio');
  });
});
