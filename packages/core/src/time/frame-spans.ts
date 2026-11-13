// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Half-open runs of frames on one clock, [start, end): merge, subtract, measure (round P3-3). Planners work
 * in frame numbers and may use fractions while planning (a clip's frames at its speed); store the result as
 * RationalTime. The timeline's cleanup planner and time map and render's QA plan share these.
 */

/** A half-open run of frames [start, end) on one clock. Fractions are allowed while planning. */
export interface FrameSpan {
  readonly start: number;
  readonly end: number;
}

/** How many frames a span holds; 0 when it is empty or reversed. */
export const spanFrames = (span: FrameSpan): number => Math.max(0, span.end - span.start);

/** Sorted by start; overlapping and touching spans joined; empty ones dropped. */
export function mergeSpans(spans: readonly FrameSpan[]): FrameSpan[] {
  const sorted = spans.filter((span) => span.end > span.start).sort((a, b) => a.start - b.start);
  const merged: FrameSpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end)
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, span.end) };
    else merged.push({ start: span.start, end: span.end });
  }
  return merged;
}

/** `from` minus every hole, merged. */
export function subtractSpans(from: readonly FrameSpan[], holes: readonly FrameSpan[]): FrameSpan[] {
  const cut = mergeSpans(holes);
  const kept: FrameSpan[] = [];
  for (const span of mergeSpans(from)) {
    let start = span.start;
    for (const hole of cut) {
      if (hole.end <= start || hole.start >= span.end) continue;
      if (hole.start > start) kept.push({ start, end: hole.start });
      start = Math.max(start, hole.end);
    }
    if (start < span.end) kept.push({ start, end: span.end });
  }
  return kept;
}

/** How many frames of `span` the `cover` covers. Overlaps within `cover` count once. */
export function coveredFrames(span: FrameSpan, cover: readonly FrameSpan[]): number {
  return mergeSpans(cover).reduce(
    (sum, part) => sum + Math.max(0, Math.min(part.end, span.end) - Math.max(part.start, span.start)),
    0,
  );
}
