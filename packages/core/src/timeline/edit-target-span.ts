// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: where an edit target sits on its timeline now, in canvas frames, for the editor's comment pins, the
 * agent's comment tools and the library, which moves comments with their anchors. Items are placed by ctx's
 * editItemsOf (edit-items.ts); a range is its own span, the whole timeline its video track's length.
 */
import type { FrameSpan } from '../time/frame-spans';
import { RationalTime } from '../time/rational-time';
import { editItemsOf, type EditItemPlace } from './edit-items';
import type { EditTarget } from './edit-target';
import type { Timeline } from './timeline-schema';

/** Every item a person can point at, by id. */
export type EditItemMap = ReadonlyMap<string, EditItemPlace>;

export function editItemMap(timeline: Timeline): EditItemMap {
  return new Map(editItemsOf(timeline).map((place) => [place.target.itemId as string, place]));
}

/** The film's length in canvas frames: its video track's. */
export function timelineFrames(timeline: Timeline): number {
  const rate = timeline.canvas.rate;
  const video = timeline.tracks.find((track) => track.kind === 'video');
  return (video?.items ?? []).reduce(
    (sum, item) => (item.type === 'transition' ? sum : sum + RationalTime.toFrames(item.duration, rate)),
    0,
  );
}

/** Where `target` is now ([start, end) in canvas frames); null when it is on another timeline or its item is gone. */
export function editTargetSpan(
  timeline: Timeline,
  target: EditTarget,
  items: EditItemMap = editItemMap(timeline),
): FrameSpan | null {
  if (target.timelineId !== timeline.id) return null;
  if (target.kind === 'timeline') return { start: 0, end: timelineFrames(timeline) };
  if (target.kind === 'range') {
    const rate = timeline.canvas.rate;
    const start = Math.max(0, RationalTime.toFrames(target.range.start, rate));
    return { start, end: start + Math.max(0, RationalTime.toFrames(target.range.duration, rate)) };
  }
  const item = items.get(target.itemId);
  return item ? { start: Math.max(0, item.start), end: Math.max(0, item.end) } : null;
}

/**
 * The frame a moment `at` inside `target` falls on (its start without one), kept inside the target's span; null when
 * the target is gone.
 */
export function editTargetFrame(
  timeline: Timeline,
  target: EditTarget,
  at?: RationalTime,
  items?: EditItemMap,
): number | null {
  const span = editTargetSpan(timeline, target, items);
  if (!span) return null;
  const offset = at ? RationalTime.toFrames(at, timeline.canvas.rate) : 0;
  return Math.min(Math.max(span.start, span.start + offset), Math.max(span.start, span.end - 1));
}
