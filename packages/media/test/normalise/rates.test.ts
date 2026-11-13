// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Speed from the stream's average rate and the phone's capture rate (LIB1-FIX). A phone's variable frame timing
 * averages a little under the rate it shot at: that is a normal clip on the capture rate's grid, not slow motion.
 * Slow motion and time-lapse need the capture rate well away from playback (at least about twice, or half).
 */
import { describe, expect, it } from 'vitest';
import { FrameRate } from '@taalcut/core';
import { gridFor } from '../../src/normalise/rates';

describe('gridFor', () => {
  it('calls a 30 fps capture with variable timing (average 28.91) normal speed, on the 30 grid', () => {
    // An Android phone clip: com.android.capture.fps 30, an average of 28.91 from variable frame timing.
    const grid = gridFor({ num: 2_891, den: 100 }, 30);
    expect(grid.speed).toEqual({ kind: 'normal', factor: 1, retimedInFile: false });
    expect(grid.output).toEqual(FrameRate.of(30));
    expect(grid.native).toBeUndefined();
    expect(grid.captureRate).toBeUndefined();
  });

  it('keeps a variable average within 5% of the capture rate normal on either side', () => {
    for (const fps of [28.6, 29.5, 30, 30.6, 31.4]) {
      const grid = gridFor({ num: Math.round(fps * 1000), den: 1000 }, 30);
      expect(grid.speed.kind, `${fps}`).toBe('normal');
      expect(grid.output, `${fps}`).toEqual(FrameRate.of(30));
    }
    expect(gridFor({ num: 57_600, den: 1000 }, 60).output).toEqual(FrameRate.of(60));
    expect(gridFor({ num: 23_000, den: 1000 }, 24).output).toEqual(FrameRate.of(24));
  });

  it('keeps a low-light clip that dropped frames normal speed, on its own average', () => {
    // A 30 fps capture averaging 22 fps in the dark: frames dropped, nothing slowed.
    const grid = gridFor({ num: 22, den: 1 }, 30);
    expect(grid.speed).toEqual({ kind: 'normal', factor: 1, retimedInFile: false });
    expect(grid.output).toEqual(FrameRate.of(22));
    expect(gridFor({ num: 16, den: 1 }, 30).speed.kind).toBe('normal');
  });

  it('calls a high-speed capture written at playback rate slow motion, retimed in the file', () => {
    for (const [capture, factor] of [
      [120, 4],
      [240, 8],
      [960, 32],
      [60, 2],
    ] as const) {
      const grid = gridFor({ num: 30, den: 1 }, capture);
      expect(grid.speed, `${capture}`).toEqual({ kind: 'slow-motion', factor, retimedInFile: true });
      expect(grid.output).toEqual(FrameRate.of(30));
      expect(grid.native).toEqual(FrameRate.of(capture));
      expect(grid.captureRate).toEqual(FrameRate.of(capture));
    }
    // 48 fps shot for a 25 fps file: just under twice, still slowed.
    expect(gridFor({ num: 25, den: 1 }, 48).speed.kind).toBe('slow-motion');
  });

  it('calls a slow capture written at playback rate a time-lapse', () => {
    const lapse = gridFor({ num: 30, den: 1 }, 2);
    expect(lapse.speed).toEqual({ kind: 'time-lapse', factor: 15, retimedInFile: true });
    expect(lapse.captureRate).toEqual(FrameRate.of(2));
    expect(gridFor({ num: 30, den: 1 }, 15).speed.kind).toBe('time-lapse');
    // A capture rate a little under the average is timing, not a time-lapse.
    expect(gridFor({ num: 30, den: 1 }, 24).speed.kind).toBe('normal');
  });

  it('keeps a real-time high-frame-rate stream (an iPhone 240 fps clip) slow motion at 30', () => {
    const grid = gridFor({ num: 240, den: 1 });
    expect(grid.speed).toEqual({ kind: 'slow-motion', factor: 8, retimedInFile: false });
    expect(grid.output).toEqual(FrameRate.of(30));
    expect(grid.native).toEqual(FrameRate.of(240));
    // The same stream with a capture rate that matches it is still real-time high frame rate.
    expect(gridFor({ num: 240, den: 1 }, 240).speed).toEqual({
      kind: 'slow-motion',
      factor: 8,
      retimedInFile: false,
    });
  });

  it('snaps a steady stream without a capture rate as before', () => {
    expect(gridFor({ num: 30_000, den: 1001 }).output).toEqual(FrameRate.of(30_000, 1001));
    expect(gridFor({ num: 15, den: 1 }).output).toEqual(FrameRate.of(15));
    expect(gridFor({ num: 2_891, den: 100 }).output).toEqual(FrameRate.of(2_891, 100));
    expect(gridFor({ num: 30, den: 1 }).speed.kind).toBe('normal');
  });
});
