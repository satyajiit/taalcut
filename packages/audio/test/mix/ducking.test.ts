// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { DEFAULT_DUCKING } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CHECK_REACH_MS, gainAt, planEnvelope, windowGain } from '../../src/mix/ducking';
import { parseLoudnessLog } from '../../src/mix/loudness-series';
import { checkMargin } from '../../src/mix/margin';
import { voicedMsIn, voicedWindows } from '../../src/mix/voice-activity';

const sample = (ms: number) => Math.round(ms * 48);
const flat = (frames: number, value: number) => Array.from({ length: frames }, () => value);

/** 20 s: voice from 5 s to 10 s at −20 LUFS, music at −14 throughout. */
function bed() {
  const voiceMomentary = flat(200, -120).map((v, k) => (k >= 50 && k < 100 ? -20 : v));
  return {
    voiceMomentary,
    musicMomentary: flat(200, -14),
    voiceShortTerm: voiceMomentary.map((v, k) => (k >= 50 && k < 125 ? -21 : v)),
    musicShortTerm: flat(200, -14),
    windows: voicedWindows(voiceMomentary, 20_000),
    settings: DEFAULT_DUCKING,
    durationMs: 20_000,
  };
}

describe('ducking envelope', () => {
  it('finds padded voiced windows and merges short gaps', () => {
    const momentary = flat(60, -120).map((v, k) => ((k >= 10 && k < 20) || (k >= 22 && k < 30) ? -20 : v));
    expect(voicedWindows(momentary, 6000)).toEqual([{ startMs: 580, endMs: 3080 }]);
    expect(voicedMsIn([{ startMs: 0, endMs: 1000 }], 500, 3000)).toBe(500);
  });

  it('aims each window at margin + 1 LU on the short-term meter, never boosting', () => {
    const input = bed();
    expect(windowGain(input, 0)).toBeCloseTo(-21 - -14 - 9, 5);
    const loud = { ...input, musicShortTerm: flat(200, -60), musicMomentary: flat(200, -60) };
    expect(windowGain(loud, 0)).toBe(0);
  });

  it('clamps at the floor and ramps attack before, hold and release after the reach', () => {
    const input = { ...bed(), musicShortTerm: flat(200, 0) };
    const { points, windowGains } = planEnvelope(input);
    expect(windowGains[0]).toBe(DEFAULT_DUCKING.floorDb);
    const window = input.windows[0];
    if (!window) throw new Error('no window');
    const duckStart = window.startMs - CHECK_REACH_MS;
    expect(gainAt(points, sample(duckStart - DEFAULT_DUCKING.attackMs - 20))).toBe(0);
    expect(gainAt(points, sample(duckStart + 10))).toBe(-30);
    const holdEnd = window.endMs + CHECK_REACH_MS + 150;
    expect(gainAt(points, sample(holdEnd))).toBe(-30);
    expect(gainAt(points, sample(holdEnd + DEFAULT_DUCKING.releaseMs / 2))).toBeCloseTo(-15, 0);
    expect(gainAt(points, sample(holdEnd + DEFAULT_DUCKING.releaseMs + 20))).toBe(0);
    expect(points.length).toBeLessThan(12);
  });

  it('plans nothing when ducking is off', () => {
    expect(planEnvelope({ ...bed(), settings: { ...DEFAULT_DUCKING, enabled: false } }).points).toEqual([]);
  });

  it('lowers a failing window by its shortfall on the second plan', () => {
    const input = bed();
    const first = windowGain(input, 0);
    expect(windowGain({ ...input, extraDb: [3] }, 0)).toBeCloseTo(first - 3, 5);
  });
});

describe('the voice-over-music check', () => {
  it('counts only frames with 1.5 s of voice in a full 3 s window and reports the worst', () => {
    const voiceShortTerm = flat(100, -20);
    const musicShortTerm = flat(100, -30).map((v, k) => (k === 70 ? -25 : v));
    const { report, failingFrames } = checkMargin({
      voiceShortTerm,
      musicShortTerm,
      windows: [{ startMs: 2000, endMs: 8000 }],
      marginLu: 8,
    });
    expect(report.counted).toBe(61);
    expect(report.passed).toBe(false);
    expect(report.minMarginLu).toBe(5);
    expect(report.worst[0]).toEqual({ atMs: 7100, voiceLufs: -20, musicLufs: -25 });
    expect(failingFrames).toEqual([70]);
  });

  it('parses ebur128 metadata lines, -inf as silence', () => {
    const log =
      'frame:0 pts:0\nlavfi.r128.M=-inf\nlavfi.r128.S=-inf\nframe:1\nlavfi.r128.M=-23.5\nlavfi.r128.S=-30.25\n';
    expect(parseLoudnessLog(log)).toEqual({ momentary: [-120, -23.5], shortTerm: [-120, -30.25] });
  });
});
