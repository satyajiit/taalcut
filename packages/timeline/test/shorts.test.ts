// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  FrameRate,
  newId,
  RationalTime,
  timelineSchema,
  type ShortEditPlan,
  type Transcript,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { assembleShort } from '../src/assembly/short';
import { createShortLayout } from '../src/assembly/short-layout';
import { setReframe } from '../src/edits/reframe';
import { removeWords } from '../src/edits/remove-words';
import { splitClip } from '../src/edits/split';
import { transcriptOccurrences } from '../src/edits/transcript-occurrences';
import { setVisualLayout } from '../src/edits/visual-layout';
import { clipView } from '../src/tools/editor-view';
import { layoutCropAt } from '../src/model/visual-layout';

const rate = FrameRate.of(30);
const t = (frame: number) => RationalTime.of(frame, rate);
const range = (start: number, duration: number) => ({ start: t(start), duration: t(duration) });
const ids = { item: () => newId<'TimelineItem'>() };

function fixture(silent = false) {
  const assetId = newId<'Asset'>();
  const brollId = newId<'Asset'>();
  const span = (id: typeof assetId, source: number, start: number) => ({
    source: { assetId: id, range: range(source, 60) },
    start: t(start),
    duration: t(60),
  });
  const plan: ShortEditPlan = {
    candidateId: newId<'ShortCandidate'>(),
    title: 'A complete answer',
    hook: 'The result',
    speech: silent ? [] : [span(assetId, 90, 0), span(assetId, 0, 60)],
    visuals: [span(brollId, 180, 0), span(assetId, 0, 60)],
    duration: t(120),
    endingDuration: t(60),
  };
  const input = {
    projectId: newId<'Project'>(),
    timelineId: newId<'Timeline'>(),
    name: plan.title,
    rate,
    plan,
    assets: new Map([
      [assetId, { available: range(0, 600) }],
      [brollId, { available: range(0, 600) }],
    ]),
    styleId: null,
    now: 10,
  };
  const result = assembleShort(input, ids);
  if (!result.ok) throw new Error(result.error.detail ?? result.error.code);
  const transcript: Transcript = {
    version: 1,
    language: 'en',
    engine: 'whisper',
    model: 'recorded',
    local: true,
    wordTiming: 'native',
    segments: [
      {
        text: 'before after',
        language: 'en',
        range: range(0, 180),
        words: [
          { text: 'before', range: range(0, 15) },
          { text: 'after', range: range(90, 15) },
        ],
      },
    ],
  };
  return { input, timeline: result.value, transcript, assetId, brollId };
}

describe('short source assembly', () => {
  it('keeps reordered speech independent of a cutaway, with source sound exactly once', () => {
    const { timeline, transcript, assetId } = fixture();
    expect(timelineSchema.safeParse(timeline).success).toBe(true);
    expect(timeline).toMatchObject({
      music: { path: 'none' },
      speechTrackId: 'A1',
      canvas: { width: 1080, height: 1920 },
    });
    expect(
      timeline.tracks[0]!.items.filter((item) => item.type === 'clip').every((item) => item.audio.muted),
    ).toBe(true);
    const words = transcriptOccurrences(timeline, new Map([[assetId, transcript]]));
    expect(words.map((word) => [word.text, word.range.start.value])).toEqual([
      ['after', 0],
      ['before', 60],
    ]);
    expect(words.every((word) => word.clipId !== timeline.tracks[0]!.items[0]!.id)).toBe(true);
    const cut = removeWords(timeline, [words[0]!], words, ids.item);
    expect(cut.ok).toBe(true);
    if (cut.ok) {
      expect(
        cut.value.timeline.tracks
          .slice(0, 2)
          .map((track) =>
            track.items.reduce((sum, item) => sum + ('duration' in item ? item.duration.value : 0), 0),
          ),
      ).toEqual([105, 105]);
      expect(
        transcriptOccurrences(cut.value.timeline, new Map([[assetId, transcript]])).map((word) => [
          word.text,
          word.range.start.value,
        ]),
      ).toEqual([['before', 45]]);
    }
  });

  it('preserves source ambience without invented speech or music', () => {
    const { timeline } = fixture(true);
    expect(timeline.speechTrackId).toBeUndefined();
    expect(
      timeline.tracks[0]!.items.filter((item) => item.type === 'clip').every((item) => !item.audio.muted),
    ).toBe(true);
  });

  it('refuses overlaps and source ranges outside available media', () => {
    const { input } = fixture();
    expect(
      assembleShort(
        {
          ...input,
          plan: { ...input.plan, visuals: input.plan.visuals.map((span) => ({ ...span, start: t(0) })) },
        },
        ids,
      ).ok,
    ).toBe(false);
    expect(
      assembleShort(
        { ...input, assets: new Map([...input.assets].map(([id]) => [id, { available: range(0, 30) }])) },
        ids,
      ).ok,
    ).toBe(false);
  });

  it('quantizes shared boundaries once for millisecond transcript intervals', () => {
    const { input, assetId } = fixture();
    const ms = FrameRate.of(1000);
    const spans = Array.from({ length: 3 }, (_, index) => ({
      source: {
        assetId,
        range: { start: RationalTime.of(index * 1050, ms), duration: RationalTime.of(1050, ms) },
      },
      start: RationalTime.of(index * 1050, ms),
      duration: RationalTime.of(1050, ms),
    }));
    const result = assembleShort(
      {
        ...input,
        plan: { ...input.plan, visuals: spans, speech: spans, duration: RationalTime.of(3150, ms) },
      },
      ids,
    );
    if (!result.ok) throw new Error(result.error.detail ?? result.error.code);
    expect(result.value.tracks[0]!.items.map((item) => item.type)).toEqual(['clip', 'clip', 'clip']);
    expect(
      result.value.tracks[0]!.items.map((item) => ('duration' in item ? item.duration.value : 0)),
    ).toEqual([32, 31, 32]);
  });
});

describe('editable source timed layouts', () => {
  it('preserves absolute crop keys through splitting and keeps speech untouched', () => {
    const { timeline } = fixture();
    const clip = timeline.tracks[0]!.items[0]!;
    const layout = createShortLayout({ at: t(180), source: { width: 1920, height: 1080 } });
    layout.regions[0]!.keyframes.push({ at: t(240), crop: { x: 0.3, y: 0, width: 0.5, height: 1 } });
    const set = setVisualLayout(timeline, { clipId: clip.id, visualLayout: layout }, { source: 'ui' });
    if (!set.ok) throw new Error(set.error.code);
    const selected = set.value.timeline.tracks[0]!.items[0]!;
    expect(selected.type === 'clip' && clipView(selected, 0, 60, rate)).toMatchObject({
      visualLayout: layout,
    });
    const reset = setReframe(set.value.timeline, { clipId: clip.id, reframe: null }, { source: 'ui' });
    if (!reset.ok) throw new Error(reset.error.code);
    const resetClip = reset.value.timeline.tracks[0]!.items[0]!;
    expect(resetClip.type === 'clip' && resetClip.visualLayout).toBeUndefined();
    const split = splitClip(
      set.value.timeline,
      { clipId: clip.id, at: t(30), snapToBeat: false },
      { source: 'ui', ids: ids.item },
    );
    if (!split.ok) throw new Error(split.error.code);
    const second = split.value.timeline.tracks[0]!.items[1]!;
    expect(second.type === 'clip' && second.visualLayout).toEqual(layout);
    expect(second.type === 'clip' && second.sourceStart.value).toBe(210);
    expect(layoutCropAt(layout.regions[0]!, 7).x).toBeCloseTo(0.15);
    expect(split.value.timeline.tracks[1]).toEqual(timeline.tracks[1]);
  });

  it('keeps two participants simultaneously and preserves protected screens or unknown scenes', () => {
    const source = { width: 1920, height: 1080 };
    const people = [
      { x: 0.1, y: 0.2, width: 0.2, height: 0.5 },
      { x: 0.7, y: 0.2, width: 0.2, height: 0.5 },
    ];
    expect(
      createShortLayout({ at: t(0), source, people }).regions.map((region) => region.viewport.y),
    ).toEqual([0, 0.5]);
    expect(
      createShortLayout({
        at: t(0),
        source,
        people: people.slice(0, 1),
        content: { x: 0.4, y: 0, width: 0.6, height: 1 },
      }).regions.map((region) => region.id),
    ).toEqual(['content', 'presenter']);
    expect(createShortLayout({ at: t(0), source }).regions[0]!.keyframes[0]!.crop).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
});
