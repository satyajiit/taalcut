// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Casting's curves and peaks from the analysis pass's samples and per-frame change. */
import { shotSignalsSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { motionPeaks, resampleCurve, shotProfileSignals } from '../../src/analysis/profile-signals';
import { VISION_CONFIG } from '../../src/config';
import type { SampleSignals } from '../../src/quality/shot-quality';

const sample = (index: number, laplacianVariance: number, change = 0, shiftX = 0): SampleSignals => ({
  index,
  laplacianVariance,
  mean: 120,
  std: 40,
  dark: 0,
  bright: 0,
  black: false,
  change,
  shift: { x: shiftX, y: 0 },
});

describe('resampleCurve', () => {
  it('puts samples on a 100 ms grid from the shot start, interpolating between them', () => {
    // 30 fps, a sample every 3 frames: 100 ms apart, so the grid lands on them.
    const points = [0, 3, 6, 9].map((index, i) => ({ index, value: i / 3 }));
    expect(resampleCurve(points, 0, 12, 30)).toEqual([0, 0.33, 0.67, 1]);
    // 25 fps sampled every 3 frames (120 ms): grid points fall between samples.
    const pal = [0, 3, 6].map((index, i) => ({ index, value: i * 0.5 }));
    expect(resampleCurve(pal, 0, 9, 25)).toEqual([0, 0.42, 0.83, 1]);
  });

  it('is relative to the shot start and holds the ends flat', () => {
    const points = [
      { index: 33, value: 0.2 },
      { index: 36, value: 0.8 },
    ];
    expect(resampleCurve(points, 30, 15, 30)).toEqual([0.2, 0.2, 0.8, 0.8, 0.8]);
    expect(resampleCurve([], 0, 30, 30)).toEqual([]);
  });
});

describe('motionPeaks', () => {
  it('finds full-rate local maxima at or above the threshold, never the cut frame', () => {
    // At 30 fps a frame's change counts 3× towards change per 100 ms; 25 scores 1.
    const change = [40, 1, 1, 2, 7, 3, 1, 1, 6, 6.5, 2, 1, 4, 1];
    expect(motionPeaks(change, 30)).toEqual([4, 9]);
    // A plateau peaks once, at its first frame.
    expect(motionPeaks([0, 1, 8, 8, 1], 30)).toEqual([2]);
    expect(motionPeaks([0, 1, 1, 1], 30)).toEqual([]);
  });

  it('keeps the strongest peaks, in frame order', () => {
    // Change 5 to 7 makes about 860 peaks (0.6 to 0.84); the 400 kept are every 7 and the earliest 6s.
    const change = Array.from({ length: 4001 }, (_, i) => (i % 2 === 1 ? 1 + (i % 7) : 0));
    const peaks = motionPeaks(change, 30);
    expect(peaks).toHaveLength(VISION_CONFIG.profile.maxPeaks);
    expect([...peaks].sort((a, b) => a - b)).toEqual(peaks);
    expect(peaks.every((frame) => (change[frame] as number) >= 6)).toBe(true);
    expect(peaks.filter((frame) => change[frame] === 7)).toHaveLength(change.filter((c) => c === 7).length);
  });
});

describe('shotProfileSignals', () => {
  it('gives a 2 s shot 20 curve samples, sharp where the samples are sharp, and its peaks', () => {
    const samples = Array.from({ length: 20 }, (_, i) =>
      sample(30 + i * 3, i < 10 ? 600 : 6, 2, i >= 10 ? 0.02 : 0),
    );
    const frameChange = Array.from({ length: 60 }, (_, i) => (i === 45 ? 9 : 1));
    const signals = shotProfileSignals({
      start: 30,
      end: 90,
      fps: 30,
      secondsPerSample: 0.1,
      samples,
      frameChange,
    });
    expect(shotSignalsSchema.safeParse(signals).success).toBe(true);
    expect(signals.sharpnessCurve).toHaveLength(20);
    expect(signals.motionCurve).toHaveLength(20);
    expect(signals.sharpnessCurve[0]).toBeGreaterThan(0.9);
    expect(signals.sharpnessCurve[19]).toBeLessThan(0.1);
    expect(signals.motionCurve[19]).toBeGreaterThan(signals.motionCurve[0] as number);
    expect(signals.motionPeakFrames).toEqual([45]);
  });

  it('takes the first sample motion from its neighbour (its change is across the cut)', () => {
    const samples = [sample(0, 100, 200, 0.5), sample(3, 100, 0, 0)];
    const signals = shotProfileSignals({
      start: 0,
      end: 6,
      fps: 30,
      secondsPerSample: 0.1,
      samples,
      frameChange: [200, 0, 0, 0, 0, 0],
    });
    expect(signals.motionCurve).toEqual([0, 0]);
    expect(signals.motionPeakFrames).toEqual([]);
  });

  it('leaves curves empty past the cap, but keeps peaks', () => {
    const fps = 30;
    const frames = (VISION_CONFIG.profile.maxCurveSamples / 10 + 1) * fps;
    const signals = shotProfileSignals({
      start: 0,
      end: frames,
      fps,
      secondsPerSample: 0.1,
      samples: [sample(0, 100), sample(3, 100)],
      frameChange: [0, 1, 9, 1],
    });
    expect(signals.motionCurve).toEqual([]);
    expect(signals.sharpnessCurve).toEqual([]);
    expect(signals.motionPeakFrames).toEqual([2]);
  });
});
