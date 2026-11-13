// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.dropSlot (P3-B8) on the fake's documents, as packages/timeline does it: the clip or gap leaves V1 with
 * the transitions on its cuts.
 * - ripple: everything after moves earlier by its length; text, graphics, markers and caption cues go through
 *   the same cut of time (what sat inside the dropped span goes, what spanned it gets shorter), audio tracks lose
 *   the span, and the moved clips take the beat nearest their new start.
 * - extendPrevious: the clip before takes the time (its end rolls over its media), else the clip after (its start
 *   rolls back), else it ripples.
 * The cast slot keeps its pick with note `dropped` and no clip. Refusals: an unknown item, a clip the agent
 * can't touch (locked), and a video that would be empty.
 */
import {
  RationalTime,
  type CommandSource,
  type SequenceItem,
  type Timeline,
  type TimelineItemId,
  type TimeRange,
  type Track,
} from '@taalcut/core';
import { beatGrid, timelineError, type Edit } from '../../edits';
import { positionsOf, v1Items, withV1, type Position } from './gap-reads';

// Developer detail on a refusal, as the real handler's InvalidMove carries it: never shown to people.
const EMPTY_DETAIL = 'The video would be empty';

/** Frames after the span move back by its length; a frame inside it lands on its start. */
const cutAt = (frame: number, start: number, end: number) =>
  frame < start ? frame : frame >= end ? frame - (end - start) : start;

/** A range through the cut; null when it sat inside the span. */
function cutRange(range: TimeRange, start: number, end: number): TimeRange | null {
  const from = cutAt(range.start.value, start, end);
  const to = cutAt(range.start.value + range.duration.value, start, end);
  if (to <= from) return null;
  return {
    start: RationalTime.of(from, range.start.rate),
    duration: RationalTime.of(to - from, range.start.rate),
  };
}

/** V1 without the item and the transitions either side of it. */
function without(items: readonly SequenceItem[], index: number): SequenceItem[] {
  return items.filter((item, at) => {
    if (at === index) return false;
    return !((at === index - 1 || at === index + 1) && item.type === 'transition');
  });
}

/** An audio sequence without [start, end): items inside go, items across it lose that part. */
function cutSequence(items: readonly SequenceItem[], start: number, end: number): SequenceItem[] {
  let frame = 0;
  return items.flatMap((item): SequenceItem[] => {
    if (item.type === 'transition') return [item];
    const from = frame;
    const to = frame + item.duration.value;
    frame = to;
    const kept = to - from - Math.max(0, Math.min(to, end) - Math.max(from, start));
    if (kept <= 0) return [];
    if (kept === to - from) return [item];
    const duration = RationalTime.of(kept, item.duration.rate);
    // A clip that loses its head starts later in its media, as a trim does; one that loses its tail keeps its in-point.
    const head = from >= start ? Math.min(to, end) - from : 0;
    if (item.type !== 'clip' || head === 0) return [{ ...item, duration }];
    const skip = RationalTime.rescale(
      RationalTime.of(head, item.duration.rate),
      item.sourceStart.rate,
      'floor',
    );
    return [
      {
        ...item,
        duration,
        sourceStart: RationalTime.of(item.sourceStart.value + skip.value, item.sourceStart.rate),
      },
    ];
  });
}

/** The neighbour that can take the dropped frames, as the new V1; null when neither can. */
function extended(timeline: Timeline, position: Position, all: readonly Position[], source: CommandSource) {
  const items = v1Items(timeline);
  const at = all.indexOf(position);
  const frames = position.end - position.start;
  for (const [neighbour, edge] of [
    [all[at - 1], 'end'],
    [all[at + 1], 'start'],
  ] as const) {
    const clip = neighbour?.item;
    if (
      !neighbour ||
      clip?.type !== 'clip' ||
      (clip.locked && source === 'agent') ||
      clip.media.kind === 'image'
    )
      continue;
    const media = clip.media.kind === 'video' || clip.media.kind === 'audio' ? clip.media.available : null;
    if (!media) continue;
    const rate = timeline.canvas.rate;
    const extra = RationalTime.rescale(RationalTime.of(frames, rate), media.start.rate, 'ceil').value;
    const inPoint = clip.sourceStart.value - (edge === 'start' ? extra : 0);
    const outPoint =
      clip.sourceStart.value +
      RationalTime.rescale(clip.duration, media.start.rate, 'ceil').value +
      (edge === 'end' ? extra : 0);
    if (inPoint < media.start.value || outPoint > media.start.value + media.duration.value) continue;
    const grown = {
      ...clip,
      duration: RationalTime.of(clip.duration.value + frames, rate),
      sourceStart: RationalTime.of(inPoint, clip.sourceStart.rate),
    };
    const out = [...items];
    out[neighbour.itemIndex] = grown;
    return without(out, position.itemIndex);
  }
  return null;
}

/** Moved clips take the beat nearest their new start. */
function reanchor(timeline: Timeline, items: readonly SequenceItem[], from: number): SequenceItem[] {
  const beats = timeline.beatMap?.beats.length ?? 0;
  let frame = 0;
  const length = items.reduce(
    (sum, item) => (item.type === 'transition' ? sum : sum + item.duration.value),
    0,
  );
  const grid = beatGrid(timeline, length).slice(0, beats);
  return items.map((item) => {
    if (item.type === 'transition') return item;
    const start = frame;
    frame += item.duration.value;
    if (item.type !== 'clip' || start < from || grid.length === 0) return item;
    let index = 0;
    for (let i = 1; i < grid.length; i += 1)
      if (Math.abs(grid[i]! - start) < Math.abs(grid[index]! - start)) index = i;
    return {
      ...item,
      beatAnchor: { beatIndex: index, offset: RationalTime.of(start - grid[index]!, item.duration.rate) },
    };
  });
}

export function dropSlot(
  timeline: Timeline,
  input: { readonly itemId: TimelineItemId; readonly mode: 'ripple' | 'extendPrevious' },
  source: CommandSource,
): Edit {
  const all = positionsOf(timeline);
  const position = all.find((entry) => entry.item.id === input.itemId);
  if (!position)
    return { ok: false, error: timelineError('timeline.item_not_found', { itemId: input.itemId }) };
  const { item } = position;
  if (item.type === 'clip' && item.locked && source === 'agent')
    return { ok: false, error: timelineError('timeline.clip_locked', { clipId: item.id }) };
  const cast = timeline.cast && {
    ...timeline.cast,
    slots: timeline.cast.slots.map((slot) =>
      slot.slotId === item.slotId || slot.clipId === item.id
        ? { ...slot, clipId: null, note: 'dropped' as const }
        : slot,
    ),
  };
  if (input.mode === 'extendPrevious') {
    const items = extended(timeline, position, all, source);
    if (items) return { ok: true, timeline: { ...timeline, cast, tracks: withV1(timeline, items) } };
  }
  if (all.length === 1)
    return {
      ok: false,
      error: { ...timelineError('timeline.invalid_move'), detail: EMPTY_DETAIL },
    };
  const { start, end } = position;
  const v1 = reanchor(timeline, without(v1Items(timeline), position.itemIndex), start);
  const tracks = timeline.tracks.map((track, index): Track => {
    if (index === 0 && track.kind === 'video') return { ...track, items: v1 };
    if (track.kind === 'audio') return { ...track, items: cutSequence(track.items, start, end) };
    if (track.kind !== 'text') return track;
    const items = track.items.flatMap((text) => {
      const range = cutRange({ start: text.start, duration: text.duration }, start, end);
      return range ? [{ ...text, start: range.start, duration: range.duration }] : [];
    });
    return { ...track, items };
  });
  const markers = timeline.markers.flatMap((marker) => {
    const range = cutRange(marker.range, start, end);
    return range ? [{ ...marker, range }] : [];
  });
  const captions = timeline.captions && {
    ...timeline.captions,
    cues: timeline.captions.cues.flatMap((cue) => {
      const range = cutRange(cue.range, start, end);
      if (!range) return [];
      const words = cue.words.flatMap((word) => {
        const at = cutRange(word.range, start, end);
        return at ? [{ ...word, range: at }] : [];
      });
      return words.length > 0 ? [{ ...cue, range, words }] : [];
    }),
  };
  return { ok: true, timeline: { ...timeline, cast, tracks, markers, captions } };
}
