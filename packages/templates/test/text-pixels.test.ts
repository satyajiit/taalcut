// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** FIX-SIGN: the pixel measures, on made-up grey images. */
import { describe, expect, it } from 'vitest';
import { pairsToRead } from '../src/breakdown/text-motion';
import { bestShift, fillOf, inkError, inkOf, sideCover, type Grey } from '../src/breakdown/text-pixels';

const W = 120;
const H = 80;
const noise = (x: number, y: number) => (((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) + 1) % 1;
/** A textured picture, moved by (dx, dy). */
const picture = (dx = 0, dy = 0, paint?: (x: number, y: number) => number | null): Grey => {
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      data[y * W + x] = paint?.(x, y) ?? 40 + 160 * noise(Math.floor((x - dx) / 3), Math.floor((y - dy) / 3));
  return { width: W, height: H, data };
};
const words = { left: 40, top: 30, right: 80, bottom: 42 };
/** Bars of ink on a white fill round the words: a bubble. */
const bubble = (x: number, y: number) =>
  x >= 32 && x < 88 && y >= 24 && y < 48
    ? x >= 40 && x < 80 && y >= 32 && y < 40 && x % 4 < 2
      ? 20
      : 250
    : null;

describe('text pixels', () => {
  it('finds how far a patch moved, and that a still one did not', () => {
    const shift = bestShift(picture(), picture(5, -3), words, 12);
    expect([shift.dx, shift.dy]).toEqual([5, -3]);
    expect(shift.error).toBeLessThan(shift.still);
    expect(bestShift(picture(), picture(), words, 12)).toMatchObject({ dx: 0, dy: 0 });
  });

  it('matches the words’ ink even where the picture between the letters moved', () => {
    const before = picture(0, 0, bubble);
    const after = picture(6, 2, bubble);
    const { ink, contrast } = inkOf(before, words);
    expect(contrast).toBeGreaterThan(200);
    expect(inkError(before, after, words, ink, { dx: 0, dy: 0 })).toBeLessThan(1);
  });

  it('sees words cut from one side, and nothing in words that all changed or all held', () => {
    const before = picture(0, 0, bubble);
    const hidden = picture(0, 0, (x, y) => (x < 55 ? 90 : bubble(x, y)));
    const zero = { dx: 0, dy: 0, error: 0, still: 0 };
    expect(sideCover(before, hidden, words, zero, 30)).toBeGreaterThan(0.3);
    expect(sideCover(before, before, words, zero, 30)).toBe(0);
    expect(
      sideCover(
        before,
        picture(0, 0, () => 128),
        words,
        zero,
        30,
      ),
    ).toBe(0);
  });

  it('finds a still, bounded fill round a bubble’s words, and none round words on a moving picture', () => {
    const frames = [0, 2, 4].map((dx) => picture(dx, 0, bubble));
    expect(fillOf(frames, words)).toMatchObject({ bounded: true });
    expect(fillOf(frames, words).evenness).toBeGreaterThan(0.9);
    const plain = [0, 3, 6].map((dx) =>
      picture(dx, dx, (x, y) => (x >= 40 && x < 80 && y >= 32 && y < 40 && x % 4 < 2 ? 250 : null)),
    );
    expect(fillOf(plain, words).evenness).toBeLessThan(0.5);
  });

  it('reads pairs inside one shot, short ones and long ones, with the settling ends left out', () => {
    const pairs = pairsToRead({ start: 10, end: 130 }, [100], 200);
    expect(pairs.every(([a, b]) => a >= 16 && b < 94)).toBe(true);
    expect(pairs.filter(([a, b]) => b - a === 3)).toHaveLength(4);
    expect(pairsToRead({ start: 10, end: 12 }, [], 200)).toEqual([]);
  });
});
