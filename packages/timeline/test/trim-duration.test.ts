// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.trimToDuration (P2-M8, render QA's too-long fix) on core's bus:
 * the video ends on a beat at or before the limit, the clip crossing it
 * ripples shorter, everything wholly past it goes (cast slots keep their
 * note), text, markers and caption cues are cut to the end, agents can't cut
 * a locked clip, and one ⌘Z puts the video back.
 */
import {
  createCommandBus,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  newId,
  RationalTime,
  timelineSchema,
  type CommandOrigin,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTimelineCommands } from '../src/commands/commands';
import { trimToDuration } from '../src/edits/trim-duration';
import { marker, MARKER_LABELS } from '../src/model/markers';
import { createMemoryTimelineStore } from './fixtures/store';
import { buildTimeline, starts, type ClipDef, type TextDef } from './fixtures/timeline';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };
const agent: CommandOrigin = { source: 'agent', actor: 'agent:run' };

async function setup(clips: ClipDef[], options: { beats?: boolean; texts?: TextDef[] } = {}) {
  const clock = createManualClock(1_000);
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  const store = createMemoryTimelineStore();
  bus.register(...createTimelineCommands({ store, events: createEventBus({ clock }), clock }).all);
  const built = buildTimeline({
    clips,
    beats: options.beats ?? true,
    ...(options.texts ? { texts: options.texts } : {}),
  });
  await bus.dispatch(
    'timeline.create',
    { projectId: built.timeline.projectId, timelines: [built.timeline] },
    ui,
  );
  const target = { projectId: built.timeline.projectId, timelineId: built.timeline.id };
  const read = () => store.docs.get(built.timeline.id) as Timeline;
  const trim = (maxSeconds: number, origin: CommandOrigin = agent) =>
    bus.dispatch('timeline.trimToDuration', { ...target, maxSeconds }, origin);
  return { bus, built, target, read, trim };
}

describe('timeline.trimToDuration', () => {
  it('ends on the beat at the limit, ripples the clip crossing it and drops the rest, undoably', async () => {
    const { bus, built, target, read, trim } = await setup([{ frames: 60 }, { frames: 60 }, { frames: 60 }], {
      texts: [
        { start: 90, frames: 30 },
        { start: 150, frames: 20, track: 1 },
      ],
    });
    expect(starts(read())).toEqual([0, 60, 120, 180]);
    expect((await trim(3.5)).ok).toBe(true);
    const trimmed = read();
    expect(starts(trimmed)).toEqual([0, 60, 105]);
    // The third clip's slot keeps its place in the cast, with no clip.
    expect(trimmed.cast?.slots.map((slot) => slot.clipId)).toEqual([built.ids[0], built.ids[1], null]);
    const texts = trimmed.tracks.flatMap((track) => (track.kind === 'text' ? track.items : []));
    expect(texts.map((item) => [item.start.value, item.duration.value])).toEqual([[90, 15]]);
    await bus.undo(target.projectId, ui);
    expect(starts(read())).toEqual([0, 60, 120, 180]);
    expect(read().cast?.slots.map((slot) => slot.clipId)).toEqual(built.ids);
  });

  it('ends on a cut that is already a beat when one is in reach', async () => {
    const { read, trim } = await setup([{ frames: 60 }, { frames: 60 }, { frames: 60 }]);
    expect((await trim(4.1)).ok).toBe(true);
    expect(starts(read())).toEqual([0, 60, 120]);
  });

  it('never leaves the last clip under the minimum: it goes instead', async () => {
    const { read, trim } = await setup([{ frames: 60 }, { frames: 60 }], { beats: false });
    expect((await trim(63 / 30)).ok).toBe(true);
    expect(starts(read())).toEqual([0, 60]);
  });

  it('trims to the frame without a beat map', async () => {
    const { read, trim } = await setup([{ frames: 60 }, { frames: 60 }], { beats: false });
    expect((await trim(3)).ok).toBe(true);
    expect(starts(read())).toEqual([0, 60, 90]);
  });

  it('writes nothing when the video already fits', async () => {
    const { read, trim } = await setup([{ frames: 60 }, { frames: 60 }]);
    const revision = read().revision;
    expect((await trim(10)).ok).toBe(true);
    expect(read().revision).toBe(revision);
  });

  it('keeps agents off a locked clip past the limit; the user may', async () => {
    const { read, trim } = await setup([{ frames: 60 }, { frames: 60, locked: true }]);
    const refused = await trim(2.5);
    expect(!refused.ok && refused.error.code).toBe('timeline.clip_locked');
    expect((await trim(2.5, ui)).ok).toBe(true);
    expect(starts(read())).toEqual([0, 60, 75]);
  });

  it('drops a transition into a clip that went', async () => {
    const { read, trim } = await setup([{ frames: 60 }, { frames: 60, transition: ['dissolve', 5, 5] }]);
    expect((await trim(2)).ok).toBe(true);
    const video = read().tracks[0];
    expect(video?.kind === 'video' && video.items.map((item) => item.type)).toEqual(['clip']);
  });
});

describe('trimToDuration, the pure edit', () => {
  it('cuts markers and caption cues to the end and keeps the document valid', () => {
    const { timeline } = buildTimeline({ clips: [{ frames: 60 }, { frames: 60 }, { frames: 60 }] });
    const rate = timeline.canvas.rate;
    const cue = (start: number, words: readonly [number, number][]) => ({
      id: newId<'CaptionCue'>(),
      range: {
        start: RationalTime.of(start, rate),
        duration: RationalTime.of(words.at(-1)![0] + words.at(-1)![1] - start, rate),
      },
      words: words.map(([at, frames]) => ({
        text: 'word',
        range: { start: RationalTime.of(at, rate), duration: RationalTime.of(frames, rate) },
        confidence: 1,
      })),
      edited: false,
    });
    const doc: Timeline = timelineSchema.parse({
      ...timeline,
      markers: [
        marker(newId<'TimelineItem'>(), 'hook', MARKER_LABELS.hook, 0, 30, rate),
        marker(newId<'TimelineItem'>(), 'note', 'crossing', 100, 20, rate),
        marker(newId<'TimelineItem'>(), 'note', 'past', 150, 5, rate),
      ],
      captions: {
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
          cue(10, [[10, 10]]),
          cue(95, [
            [95, 8],
            [103, 10],
          ]),
          cue(140, [[140, 10]]),
        ],
      },
    });
    const result = trimToDuration(doc, { maxSeconds: 3.5 }, { source: 'agent' });
    if (!result.ok) throw new Error(result.error.code);
    const trimmed = result.value.timeline;
    expect(timelineSchema.safeParse(trimmed).success).toBe(true);
    expect(
      trimmed.markers.map((item) => [item.label, item.range.start.value, item.range.duration.value]),
    ).toEqual([
      [MARKER_LABELS.hook, 0, 30],
      ['crossing', 100, 5],
    ]);
    expect(trimmed.captions?.cues.map((item) => [item.range.start.value, item.range.duration.value])).toEqual(
      [
        [10, 10],
        [95, 10],
      ],
    );
    expect(trimmed.captions?.cues[1]?.words.map((word) => word.range.duration.value)).toEqual([8, 2]);
    expect(result.value.changed).toEqual(['tracks', 'markers', 'cast', 'captions']);
  });
});
