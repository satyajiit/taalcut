// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FrameRate, ok, type NormalisedBox, type OnScreenText } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { joinCounterPieces } from '../../src/ocr/counter-pieces';
import { isCounter } from '../../src/ocr/counter-text';
import { trackOnScreenText } from '../../src/ocr/track';
import type { OcrFrames } from '../../src/ocr/track-refine';
import type { OcrObservation } from '../../src/ocr/types';
import { observation } from './helpers/fakes';

const RATE = FrameRate.of(30);
const END = 300;
// A clock read whole, and the pieces macOS 27.2's Vision reads it as (made-up boxes of the in-place fixture's shape).
const CLOCK: NormalisedBox = { x: 0.23, y: 0.06, width: 0.35, height: 0.08 };
const HOURS: NormalisedBox = { x: 0.23, y: 0.06, width: 0.165, height: 0.07 };
const SECONDS: NormalisedBox = { x: 0.4, y: 0.062, width: 0.08, height: 0.068 };
const MILLIS: NormalisedBox = { x: 0.49, y: 0.065, width: 0.088, height: 0.065 };
const TITLE: NormalisedBox = { x: 0.23, y: 0.72, width: 0.5, height: 0.11 };

function clock(frame: number): string {
  const ms = Math.round((frame / 30) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `00:00:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/** The clock over the whole clip and a title under it; at `split` frames the clock comes in `pieces`. */
function clip(split: ReadonlySet<number>, pieces: (frame: number) => OcrObservation[]) {
  const shown = (frame: number): OcrObservation[] => [
    ...(split.has(frame) ? pieces(frame) : [observation(clock(frame), CLOCK)]),
    ...(frame >= 95 && frame < 205 ? [observation('LIVE TONIGHT', TITLE)] : []),
  ];
  const pages = Array.from({ length: END / 30 }, (_, i) => ({ frame: i * 30, observations: shown(i * 30) }));
  const ocrFrames: OcrFrames = async (frames) =>
    ok(frames.map((frame) => ({ frame, observations: shown(frame) })));
  return { rate: RATE, pages, endFrame: END, ocrFrames };
}

const span = (t: OnScreenText) => [t.range.start.value, t.range.start.value + t.range.duration.value];
const top = (texts: readonly OnScreenText[]) => texts.filter((t) => t.box.y < 0.2);

describe('a counter read in pieces (FIX-CLOCK)', () => {
  it('keeps a clock read in two pieces one text over the clip, its box the whole clock', async () => {
    const two = (frame: number) => [
      observation('00:00:', HOURS),
      observation(clock(frame).slice(-3), MILLIS),
    ];
    const result = await trackOnScreenText(clip(new Set([90, 270]), two));
    if (!result.ok) throw new Error(result.error.code);
    const clocks = top(result.value);
    expect(clocks.map((t) => isCounter(t.text))).toEqual([true]);
    expect(clocks.map(span)).toEqual([[0, END]]);
    expect(clocks[0]?.box.x).toBeCloseTo(CLOCK.x, 2);
    expect(clocks[0]?.box.width).toBeCloseTo(CLOCK.width, 2);
    expect(result.value.filter((t) => t.text === 'LIVE TONIGHT')).toHaveLength(1);
  });

  it('keeps a clock read in three pieces one text, from a first sample read in pieces', async () => {
    const three = (frame: number) => [
      observation('00:00:', HOURS),
      observation(clock(frame).slice(6, 9), SECONDS),
      observation(clock(frame).slice(-3), MILLIS),
    ];
    const result = await trackOnScreenText(clip(new Set([0, 150, 180]), three));
    if (!result.ok) throw new Error(result.error.code);
    const clocks = top(result.value);
    expect(clocks.map((t) => isCounter(t.text))).toEqual([true]);
    expect(clocks.map(span)).toEqual([[0, END]]);
  });

  it('joins pieces further apart when the box the clock was last read in holds them', async () => {
    // "00:" and "000": seven characters of the clock between them, too far apart on their own.
    const wide = (frame: number) => [
      observation('00:', { ...HOURS, width: 0.08 }),
      observation(clock(frame).slice(-3), MILLIS),
    ];
    const result = await trackOnScreenText(clip(new Set([120, 240]), wide));
    if (!result.ok) throw new Error(result.error.code);
    expect(top(result.value).map(span)).toEqual([[0, END]]);
  });

  it('joins pieces left to right into one reading, as sure as its least sure piece', () => {
    const joined = joinCounterPieces([
      observation('000', MILLIS, 0.9),
      observation('LIVE TONIGHT', TITLE),
      observation('00:00:', HOURS, 0.6),
      observation('03.', SECONDS, 1),
    ]);
    expect(joined.map((o) => o.text)).toEqual(['00:00: 03. 000', 'LIVE TONIGHT']);
    expect(joined[0]?.confidence).toBe(0.6);
    expect(joined[0]?.box.x).toBeCloseTo(HOURS.x, 5);
    expect((joined[0]?.box.x ?? 0) + (joined[0]?.box.width ?? 0)).toBeCloseTo(MILLIS.x + MILLIS.width, 5);
  });

  it('leaves unrelated neighbours apart: names beside a score, counters far apart or on other lines', () => {
    const line = (x: number, width: number): NormalisedBox => ({ x, y: 0.08, width, height: 0.06 });
    const board = [
      observation('HOME', line(0.06, 0.11)),
      observation('2 - 1', line(0.41, 0.14)),
      observation('AWAY', line(0.71, 0.11)),
    ];
    expect(joinCounterPieces(board).map((o) => o.text)).toEqual(['HOME', '2 - 1', 'AWAY']);
    // A clock at the left and a score at the right of one line: ten characters apart, no box holding both.
    const apart = [observation('12:45', line(0.05, 0.14)), observation('3 - 1', line(0.47, 0.14))];
    expect(joinCounterPieces(apart, [line(0.05, 0.14)]).map((o) => o.text)).toEqual(['12:45', '3 - 1']);
    // A year on the line under the clock, and a score twice the clock's height beside it.
    const under = [
      observation('00:00:', HOURS),
      observation('2026', { ...MILLIS, y: 0.15 }),
      observation('3 - 1', { ...MILLIS, height: 0.14 }),
    ];
    expect(joinCounterPieces(under, [CLOCK]).map((o) => o.text)).toEqual(['00:00:', '2026', '3 - 1']);
  });
});
