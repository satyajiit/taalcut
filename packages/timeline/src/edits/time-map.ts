// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Old timeline time → new, for every edit that takes spans out of the video and closes the hole (dropping a
 * slot, a talking-head cleanup): a frame moves earlier by the frames removed before it, and a frame inside a
 * removed span lands where that span was. Frames are canvas frames.
 */
import { merge, type Interval } from '../model/intervals';

/** A span of canvas frames, [start, end). */
export type Span = Interval;

export interface TimeMap {
  /** Sorted, merged, each at least one frame. */
  readonly removed: readonly Span[];
}

export function timeMap(removed: readonly Span[]): TimeMap {
  return { removed: merge(removed) };
}

/** Where old frame `frame` is now. */
export function mapFrame(map: TimeMap, frame: number): number {
  let removed = 0;
  for (const span of map.removed) {
    if (span.start >= frame) break;
    removed += Math.min(span.end, frame) - span.start;
  }
  return frame - removed;
}

/** An old span [start, end) now; it may have shrunk to nothing. */
export function mapSpan(map: TimeMap, start: number, end: number): Span {
  return { start: mapFrame(map, start), end: mapFrame(map, end) };
}

/** True when old frame `frame` is inside a removed span (its start included). */
export function isRemoved(map: TimeMap, frame: number): boolean {
  return map.removed.some((span) => frame >= span.start && frame < span.end);
}

export const removedFrames = (map: TimeMap): number =>
  map.removed.reduce((sum, span) => sum + span.end - span.start, 0);
