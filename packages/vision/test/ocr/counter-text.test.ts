// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FrameRate, ok, type NormalisedBox } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { isCounter, sameCounter } from '../../src/ocr/counter-text';
import { createOcrMeter } from '../../src/ocr/meter';
import { trackOnScreenText } from '../../src/ocr/track';
import type { OcrFrames } from '../../src/ocr/track-refine';
import type { OcrObservation } from '../../src/ocr/types';
import { observation } from './helpers/fakes';

const RATE = FrameRate.of(30);
const CLOCK: NormalisedBox = { x: 0.4, y: 0.05, width: 0.2, height: 0.04 };
const SCORE: NormalisedBox = { x: 0.05, y: 0.05, width: 0.3, height: 0.05 };
const TITLE: NormalisedBox = { x: 0.1, y: 0.8, width: 0.6, height: 0.06 };

/** testsrc2's clock at a grid frame: hh:mm:ss.mmm of the frame's time. */
function clock(frame: number): string {
  const ms = Math.round((frame / 30) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

describe('counters', () => {
  it('knows a counter by its digits, and one counter by its place', () => {
    expect(isCounter('00:00:12.580')).toBe(true);
    expect(isCounter('HOME 2 - 1')).toBe(false);
    expect(isCounter('2 - 1')).toBe(true);
    expect(isCounter('LIVE TONIGHT')).toBe(false);
    expect(isCounter('NEW SETUP 2026')).toBe(false);
    expect(isCounter('...')).toBe(false);
    const at = (text: string, box = CLOCK) => ({ text, box });
    expect(sameCounter(at('00:00:09.000'), at('00:00:10.000'))).toBe(true);
    // Vision's misreads of the same clock (bench footage, in-place fixtures) stay one counter.
    expect(sameCounter(at('00:00:01.500'), at('00800805. 000'))).toBe(true);
    expect(sameCounter(at('00:00:01.500'), at('GG: G5:91.555'))).toBe(true);
    // A partial read inside the clock's box.
    const right = { x: 0.52, y: 0.05, width: 0.08, height: 0.04 };
    expect(sameCounter(at('00:00:01.000'), at('01.500', right))).toBe(true);
    expect(sameCounter(at('9', SCORE), at('10', SCORE))).toBe(true);
    // Elsewhere, or not a counter: not the same.
    expect(sameCounter(at('00:00:09.000'), at('00:00:10.000', TITLE))).toBe(false);
    expect(sameCounter(at('LIVE 1'), at('LIVE 2'))).toBe(false);
  });

  it('keeps a running clock one track over the whole shot, refined by shape at its edges', async () => {
    // A clock from frame 40 to 260 and a title from 100 to 200; samples every 30 frames.
    const shown = (frame: number): OcrObservation[] => [
      ...(frame >= 40 && frame < 260 ? [observation(clock(frame), CLOCK)] : []),
      ...(frame >= 100 && frame < 200 ? [observation('LIVE TONIGHT', TITLE)] : []),
    ];
    const pages = Array.from({ length: 10 }, (_, i) => ({ frame: i * 30, observations: shown(i * 30) }));
    const batches: number[][] = [];
    const read: OcrFrames = async (frames) => {
      batches.push([...frames]);
      return ok(frames.map((frame) => ({ frame, observations: shown(frame) })));
    };
    const meter = createOcrMeter();
    const result = await trackOnScreenText({ rate: RATE, pages, endFrame: 300, ocrFrames: read }, { meter });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [clockText, title] = result.value;
    expect(result.value).toHaveLength(2);
    expect(clockText?.reveal).toBe('none');
    expect(clockText?.text).toMatch(/^\d\d:\d\d:\d\d\.\d{3}$/);
    // The bisection closes a 30-frame gap to 4 frames in 3 reads; the clock's edges land within that.
    const start = clockText?.range.start.value ?? -1;
    const end = start + (clockText?.range.duration.value ?? 0);
    expect(start).toBeGreaterThanOrEqual(40);
    expect(start).toBeLessThanOrEqual(44);
    expect(end).toBeLessThanOrEqual(260);
    expect(end).toBeGreaterThanOrEqual(256);
    expect(title?.text).toBe('LIVE TONIGHT');
    expect(meter.counts()).toMatchObject({ tracks: 2, flickers: 0 });
  });

  it("keeps a clock one track through Vision's misreads and partial reads", async () => {
    const right = { x: 0.52, y: 0.05, width: 0.08, height: 0.04 };
    const readings: [string, NormalisedBox][] = [
      ['00:00:00.000', CLOCK],
      ['00-00:01.000', CLOCK],
      ['01.500', right],
      ['00800805. 000', CLOCK],
      ['00:00:04.000', CLOCK],
    ];
    const pages = readings.map(([text, box], i) => ({
      frame: i * 30,
      observations: [observation(text, box)],
    }));
    const meter = createOcrMeter();
    const result = await trackOnScreenText({ rate: RATE, pages, endFrame: 150 }, { meter });
    expect(result.ok && result.value.map((t) => [t.text, t.range.duration.value])).toEqual([
      // No refinement reads here: the track ends after its last sample.
      ['00:00:00.000', 121],
    ]);
    expect(meter.counts()).toMatchObject({ tracks: 1, flickers: 0 });
  });

  it('keeps a scoreboard one track while the score changes', async () => {
    const scores = ['2 - 1', '2 - 1', '3 - 1', '3 - 1', '10 - 1'];
    const pages = scores.map((score, i) => ({ frame: i * 30, observations: [observation(score, SCORE)] }));
    const result = await trackOnScreenText({ rate: RATE, pages, endFrame: 150 });
    expect(result.ok && result.value.map((t) => [t.text, t.range.duration.value])).toEqual([['2 - 1', 121]]);
  });
});
