// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * V1's layout as the fake's edits keep it (edits.ts): the clips in order, the beat grid, and `relayout`, which puts
 * new clips in the clip positions and brings beat anchors, text items and captions along. V1's gaps (Phase 3: a
 * slot with no shot yet) keep their places and their time, as the timeline package's sequence does.
 */
import { RationalTime, type Clip, type SequenceItem, type Timeline } from '@taalcut/core';

export const clipsOf = (timeline: Timeline): Clip[] =>
  (timeline.tracks[0]?.items ?? []).filter((item): item is Clip => item.type === 'clip');

/** The beat grid in canvas frames, continued past the last beat at the median spacing. */
export function beatGrid(timeline: Timeline, until: number): number[] {
  const map = timeline.beatMap;
  if (!map || map.beats.length < 2) return [];
  const rate = timeline.canvas.rate;
  const grid = map.beats.map((beat) => RationalTime.rescale(beat, rate, 'round').value);
  const steps = grid
    .slice(1)
    .map((value, i) => value - grid[i]!)
    .sort((a, b) => a - b);
  const step = Math.max(1, steps[Math.floor(steps.length / 2)]!);
  while (grid[grid.length - 1]! < until + step * 2) grid.push(grid[grid.length - 1]! + step);
  return grid;
}

/**
 * V1 with `clips` in the clip positions, in order; its gaps (Phase 3: a slot with no shot yet) and other items
 * keep their places between them, so a Phase 2 edit never drops a gap.
 */
function withClips(timeline: Timeline, clips: readonly Clip[]): SequenceItem[] {
  const track = timeline.tracks[0];
  const items: readonly SequenceItem[] = track?.kind === 'video' ? track.items : [];
  const placed: SequenceItem[] = [];
  let next = 0;
  for (const item of items) {
    const clip = item.type === 'clip' ? clips[next] : item;
    if (clip) placed.push(clip);
    if (item.type === 'clip') next += 1;
  }
  return [...placed, ...clips.slice(next)];
}

/** Puts `clips` on V1 and brings anchors, text and captions along. `before` is the layout they had. */
export function relayout(
  timeline: Timeline,
  clips: readonly Clip[],
  before: readonly Clip[] = clipsOf(timeline),
): Timeline {
  const rate = timeline.canvas.rate;
  const sequence = withClips(timeline, clips);
  const durationOf = (item: (typeof sequence)[number]) =>
    item.type === 'clip' || item.type === 'gap' ? item.duration.value : 0;
  const length = sequence.reduce((sum, item) => sum + durationOf(item), 0);
  const grid = beatGrid(timeline, length);
  const startOf = (list: typeof sequence) => {
    const starts = new Map<string, { start: number; frames: number }>();
    let at = 0;
    for (const item of list) {
      if (item.type === 'clip' || item.type === 'gap') {
        starts.set(item.slotId ?? item.id, { start: at, frames: item.duration.value });
        at += item.duration.value;
      }
    }
    return starts;
  };
  const old = startOf(withClips(timeline, before));
  const now = startOf(sequence);
  let start = 0;
  const anchored = sequence.map((item) => {
    if (item.type !== 'clip') {
      start += durationOf(item);
      return item;
    }
    const clip = item;
    const beatIndex = grid.findIndex((point) => point >= start);
    const onBeat = beatIndex >= 0 && timeline.beatMap && beatIndex < timeline.beatMap.beats.length;
    const next = {
      ...clip,
      beatAnchor: onBeat
        ? { beatIndex, offset: RationalTime.of(start - grid[beatIndex]!, rate) }
        : clip.beatAnchor && start === 0
          ? clip.beatAnchor
          : null,
    };
    start += clip.duration.value;
    return next;
  });
  const tracks = timeline.tracks.map((track, index) => {
    if (index === 0 && track.kind === 'video') return { ...track, items: anchored };
    if (track.kind !== 'text') return track;
    const items = track.items.flatMap((item) => {
      // Graphics (Timeline v2) aren't tied to a slot: they only stay inside the video.
      const key = item.type === 'text' ? item.slotId : null;
      const was = key ? old.get(key) : undefined;
      const is = key ? now.get(key) : undefined;
      if (!was || !is)
        return item.start.value < length
          ? [
              {
                ...item,
                duration: RationalTime.of(Math.min(item.duration.value, length - item.start.value), rate),
              },
            ]
          : [];
      const offset = Math.min(item.start.value - was.start, is.frames - 1);
      const whole = item.start.value === was.start && item.duration.value === was.frames;
      const frames = whole ? is.frames : Math.max(1, Math.min(item.duration.value, is.frames - offset));
      return [
        { ...item, start: RationalTime.of(is.start + offset, rate), duration: RationalTime.of(frames, rate) },
      ];
    });
    return { ...track, items };
  });
  const captions = timeline.captions && {
    ...timeline.captions,
    cues: timeline.captions.cues.flatMap((cue) => {
      if (cue.range.start.value >= length) return [];
      const end = Math.min(cue.range.start.value + cue.range.duration.value, length);
      const words = cue.words.flatMap((word) => {
        if (word.range.start.value >= end) return [];
        const wordEnd = Math.min(word.range.start.value + word.range.duration.value, end);
        return [
          {
            ...word,
            range: {
              start: word.range.start,
              duration: RationalTime.of(wordEnd - word.range.start.value, rate),
            },
          },
        ];
      });
      return words.length > 0
        ? [
            {
              ...cue,
              range: { start: cue.range.start, duration: RationalTime.of(end - cue.range.start.value, rate) },
              words,
            },
          ]
        : [];
    }),
  };
  return { ...timeline, tracks, captions };
}
