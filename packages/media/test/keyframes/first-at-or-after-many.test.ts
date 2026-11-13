// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G3: `firstAtOrAfter` with many targets. It compared two flat sums of one `gte` a target, which FFmpeg
 * refuses past 99 (its parser's depth limit, 100). Up to 32 targets the text is unchanged; past that each count is
 * a search. Evaluated here as FFmpeg does (helpers/ffmpeg-expr.ts) on keyframe timelines: the same keyframes as the
 * rule says, and the depth stays far under the limit. integration/many-keyframe-targets.test.ts reads 105 and 110
 * targets with FFmpeg.
 */
import { describe, expect, it } from 'vitest';
import { firstAtOrAfter } from '@taalcut/media';
import { FFMPEG_MAX_DEPTH, parseExpression, selectBody } from '../helpers/ffmpeg-expr';
import { firstKeyframesAtOrAfter } from '../helpers/keyframe-clips';

/** The keyframes a select keeps, run as FFmpeg's select does (`prev_selected_t` NaN until a frame is kept). */
function kept(select: string, keyframes: readonly number[]): number[] {
  const parsed = parseExpression(selectBody(select));
  const out: number[] = [];
  let previous = Number.NaN;
  for (const t of keyframes) {
    if (parsed.evaluate({ t, prev_selected_t: previous }) !== 0) {
      out.push(t);
      previous = t;
    }
  }
  return out;
}

const round = (values: readonly number[]) => values.map((value) => Math.round(value * 1000) / 1000);

describe('firstAtOrAfter with many targets', () => {
  it('keeps the old text up to 32 targets', () => {
    const targets = Array.from({ length: 32 }, (_, i) => i * 0.5);
    const sum = (at: string) => targets.map((t) => `gte(${at}\\,${(t - 0.001).toFixed(6)})`).join('+');
    expect(firstAtOrAfter(targets)).toBe(`select='gt(${sum('t')}\\,${sum('prev_selected_t')})'`);
  });

  it.for([
    ['100 targets on the keyframes', 0.5, Array.from({ length: 100 }, (_, i) => i * 0.5)],
    ['150 targets, some sharing a keyframe', 2, Array.from({ length: 150 }, (_, i) => (i * 7.3) % 290)],
    ['1000 targets between keyframes', 0.1, Array.from({ length: 1000 }, (_, i) => i * 0.1 + 0.05)],
  ] as const)('%s: the first keyframe at or after each, once', ([, gop, targets]) => {
    const sorted = [...targets].sort((a, b) => a - b);
    const last = sorted[sorted.length - 1]!;
    const keyframes = Array.from({ length: Math.ceil(last / gop) + 3 }, (_, i) => i * gop);
    const select = firstAtOrAfter(sorted);
    expect(round(kept(select, keyframes))).toEqual(round(firstKeyframesAtOrAfter(keyframes, sorted)));
    expect(parseExpression(selectBody(select)).depth).toBeLessThan(FFMPEG_MAX_DEPTH);
  });

  it('stays shallow for 10,000 targets', () => {
    const targets = Array.from({ length: 10_000 }, (_, i) => i * 0.04);
    expect(parseExpression(selectBody(firstAtOrAfter(targets))).depth).toBeLessThanOrEqual(24);
  });
});
