// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Half-open intervals on one axis (a clip's frames, as floats while planning; timeline frames in a time map):
 * merge, subtract, measure. What the cleanup planner builds its removals from, and what an edit that closes
 * holes (edits/time-map.ts) merges its removed spans with. The rules are core's frame spans (contract round
 * P3-3), shared with render's QA plan; this module keeps the timeline's names and adds `complement`.
 */
import { coveredFrames, mergeSpans, spanFrames, subtractSpans, type FrameSpan } from '@taalcut/core';

export type Interval = FrameSpan;

export const length = spanFrames;

/** Sorted, overlapping and touching intervals joined, empty ones gone. */
export const merge = mergeSpans;

/** `from` minus every hole. */
export const subtract = subtractSpans;

/** How much of `interval` the `cover` covers (overlaps in the cover count once). */
export const covered = coveredFrames;

/** [0, total) without the removals: what is kept. */
export const complement = (removals: readonly Interval[], total: number): Interval[] =>
  subtractSpans([{ start: 0, end: total }], removals);
