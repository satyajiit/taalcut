// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* model: the stories' arithmetic · mode: Persuade · system: WEB2 Remix Vernacular · states: none (pure functions) ·
 * motion: none of its own (it times the stories' runs). */

/**
 * The stories' arithmetic, pure so test/unit/ai-stories.test.ts can hold it: how long a story plays (always under five
 * seconds, WCAG 2.2.2), which segment a clock time shows, which stories flank the open one in the viewer, and where a
 * Previous or Next press lands (inside the story, or on its neighbour, as stories do).
 */

/** The whole run is never longer than this, in seconds: under the five-second pause rule with room to spare. */
export const RUN_CAP = 4.4;
/** A segment never holds longer than this, in seconds, so a two-segment story still moves. */
export const SEGMENT_CAP = 1.6;

/** How long each segment of an n-segment story holds while it plays. */
export function segmentSeconds(count: number): number {
  return count <= 0 ? 0 : Math.min(SEGMENT_CAP, RUN_CAP / count);
}

/** How long an n-segment story plays, start to finish. */
export function runSeconds(count: number): number {
  return segmentSeconds(count) * count;
}

/**
 * The segment a story shows at clock time t, where segment k runs from k to k + 1 and rests full at k + 1: 0 at the
 * start, the last one once finished (t = count).
 */
export function segmentAt(t: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.ceil(t) - 1));
}

/** The clock time a story rests at to show segment k full (and every segment before it). */
export function restTime(k: number, count: number): number {
  return Math.min(count, Math.max(0, k) + 1);
}

/** An index moved by `by`, round the ends. */
export function wrap(index: number, by: number, count: number): number {
  return count <= 0 ? 0 : (((index + by) % count) + count) % count;
}

/** The stories either side of the open one in the viewer, nearest first: `reach` each side, round the ends. */
export function neighbours(index: number, count: number, reach: number): { readonly before: number[]; readonly after: number[] } {
  const span = Math.max(0, Math.min(reach, Math.floor((count - 1) / 2)));
  const before = Array.from({ length: span }, (_, i) => wrap(index, -(i + 1), count));
  const after = Array.from({ length: span }, (_, i) => wrap(index, i + 1, count));
  return { before, after };
}

export type StepLanding =
  | { readonly kind: 'segment'; readonly at: number }
  | { readonly kind: 'story'; readonly index: number; readonly mode: 'play' | 'rest' };

/**
 * Where a press lands, as stories do: Next shows the next segment, and on the last it opens the next story, which
 * plays; Previous shows the segment before, and on the first it opens the story before, at rest on its finished state.
 */
export function stepFrom(input: { readonly at: number; readonly count: number; readonly index: number; readonly stories: number }, dir: 1 | -1): StepLanding {
  const { at, count, index, stories } = input;
  if (dir === 1) return at < count - 1 ? { kind: 'segment', at: at + 1 } : { kind: 'story', index: wrap(index, 1, stories), mode: 'play' };
  return at > 0 ? { kind: 'segment', at: at - 1 } : { kind: 'story', index: wrap(index, -1, stories), mode: 'rest' };
}
