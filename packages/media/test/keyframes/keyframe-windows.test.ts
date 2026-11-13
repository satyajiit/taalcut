// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-T2: target times grouped into keyframe-only runs, and the `select`
 * that keeps the first keyframe at or after each target. The select is
 * evaluated here the way FFmpeg's expression evaluator does (NaN compares
 * false), on keyframe timestamps, so the rule is pinned without a process.
 */
import { describe, expect, it } from 'vitest';
import {
  firstAtOrAfter,
  KEYFRAME_TAIL_SECONDS,
  KEYFRAME_WINDOW_GAP_SECONDS,
  keyframeWindows,
} from '@taalcut/media';

/** Which of `keyframes` (seconds on the run's timeline) the select keeps, evaluated as FFmpeg does. */
function kept(select: string, keyframes: readonly number[]): number[] {
  const body = /^select='gt\((.*)\\,(.*)\)'$/.exec(select);
  if (!body) throw new Error(`unexpected select: ${select}`);
  const thresholds = (side: string) =>
    [...side.matchAll(/gte\((?:t|prev_selected_t)\\,(-?[0-9.]+)\)/g)].map((m) => Number(m[1]));
  const targets = thresholds(body[1] ?? '');
  const passed = (x: number) => targets.filter((t) => x >= t).length; // NaN >= t is false
  const out: number[] = [];
  let previous = Number.NaN;
  for (const t of keyframes) {
    if (passed(t) > passed(previous)) {
      out.push(t);
      previous = t;
    }
  }
  return out;
}

describe('keyframeWindows', () => {
  it('groups the five poster targets of a 45 s clip into one run, seeking to the first', () => {
    const windows = keyframeWindows([4.5, 13.5, 22.5, 31.5, 40.5], { duration: 45 });
    expect(windows).toHaveLength(1);
    const [window] = windows;
    expect(window?.start).toBeCloseTo(4.499, 6);
    // To the tail past the last target; a later target's tail stops at the end of the file.
    expect(window?.span).toBeCloseTo(40.5 + KEYFRAME_TAIL_SECONDS - 4.499, 6);
    expect(keyframeWindows([42], { duration: 45 })[0]?.span).toBeCloseTo(45 - 41.999, 6);
    expect(window?.targets.map((t) => Number(t.toFixed(3)))).toEqual([0.001, 9.001, 18.001, 27.001, 36.001]);
  });

  it('gives an hour-long file one seek per target, each reading a short tail', () => {
    const windows = keyframeWindows([360, 1080, 1800, 2520, 3240], { duration: 3600 });
    expect(windows).toHaveLength(5);
    for (const window of windows) {
      expect(window.targets).toHaveLength(1);
      expect(window.span).toBeCloseTo(KEYFRAME_TAIL_SECONDS + 0.001, 6);
    }
  });

  it('splits at the gap, drops targets outside the file and duplicates, and sorts', () => {
    const gap = KEYFRAME_WINDOW_GAP_SECONDS;
    const windows = keyframeWindows([50, 1, 1, 1 + gap, -2, 99, Number.NaN], { duration: 60 });
    expect(windows.map((w) => w.targets.length)).toEqual([2, 1]);
    expect(windows[1]?.start).toBeCloseTo(49.999, 6);
    expect(keyframeWindows([1, 3], { duration: 10, gapSeconds: 0 })).toHaveLength(2);
  });
});

describe('firstAtOrAfter', () => {
  it('keeps the first keyframe at or after each target, never the frame before the first', () => {
    // One keyframe a second, targets between them.
    const keyframes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(kept(firstAtOrAfter([0.4, 2.5, 6.2]), keyframes)).toEqual([1, 3, 7]);
  });

  it('counts a keyframe exactly on a target as at it', () => {
    expect(kept(firstAtOrAfter([0, 2, 4]), [0, 1, 2, 3, 4, 5])).toEqual([0, 2, 4]);
  });

  it('reads a keyframe that follows two targets once: distinct frames only', () => {
    // A 10 s GOP: targets 3 and 9 both take the keyframe at 10.
    expect(kept(firstAtOrAfter([3, 9, 15, 21]), [0, 10, 20, 30])).toEqual([10, 20, 30]);
  });

  it('keeps nothing for a target with no keyframe after it', () => {
    expect(kept(firstAtOrAfter([0.5, 1.5]), [0, 1])).toEqual([1]);
  });

  it('escapes commas for a filter graph', () => {
    expect(firstAtOrAfter([1])).toBe("select='gt(gte(t\\,0.999000)\\,gte(prev_selected_t\\,0.999000))'");
  });
});
