// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { measureBs1770Loudness, normalisePcmToLufs, solveStemLoudnorm } from '../src';

function intersampleSine(amplitude = 1): Float32Array {
  const length = 24_000;
  return Float32Array.from({ length }, (_, i) => {
    // 12 kHz at 48 kHz, phase π/4: the steady samples are ±A/√2, but the sine reaches ±A.
    // Gentle fades avoid making the test a measurement of abrupt buffer-edge discontinuities.
    const fade = Math.min(1, i / 512, (length - 1 - i) / 512);
    return amplitude * (0.5 - 0.5 * Math.cos(Math.PI * fade)) * Math.sin((Math.PI * i) / 2 + Math.PI / 4);
  });
}

describe('reconstructed true peak', () => {
  it.each([1, 0.25, -0.5])('finds the analytic intersample peak at amplitude %s', (amplitude) => {
    const samples = intersampleSine(amplitude);
    const samplePeak = samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
    const expectedDbtp = 20 * Math.log10(Math.abs(amplitude));
    expect(20 * Math.log10(samplePeak)).toBeCloseTo(expectedDbtp - 3.0103, 3);
    // Independent oracle: the generating sine's amplitude, not a second call to our meter.
    expect(Math.abs(measureBs1770Loudness(samples).truePeakDbtp - expectedDbtp)).toBeLessThan(0.3);
  });

  it('uses reconstructed headroom in the stem gain solver', () => {
    const solved = solveStemLoudnorm(intersampleSine(), 48_000, 'dialogue');
    expect(solved.truePeakDbtp).toBeGreaterThan(-0.3);
    expect(solved.recommendedGainDb + solved.truePeakDbtp).toBeLessThanOrEqual(-1);
  });

  it('corrects intersample overshoot left by a sample-domain soft knee', () => {
    const output = normalisePcmToLufs(intersampleSine(), 48_000, 0, -1);
    // On this steady fs/4 sine every sample has the same magnitude after the memoryless soft knee.
    // Its reconstructed amplitude is still √2 times that magnitude, independently of our FIR.
    const steadyAmplitude = Math.abs(output[12_000]!) * Math.SQRT2;
    expect(20 * Math.log10(steadyAmplitude)).toBeLessThanOrEqual(-0.7);
    expect(measureBs1770Loudness(output).truePeakDbtp).toBeLessThanOrEqual(-1);
  });

  it('measures silence and includes the reconstruction tail at either buffer edge', () => {
    expect(measureBs1770Loudness(new Float32Array()).truePeakDbtp).toBe(-100);
    expect(measureBs1770Loudness(new Float32Array(100)).truePeakDbtp).toBe(-100);
    const edge = Float32Array.of(0, 0, 0.7, 0.7, -0.7, -0.7);
    const forward = measureBs1770Loudness(edge).truePeakDbtp;
    expect(forward).toBeGreaterThan(20 * Math.log10(0.7));
    expect(measureBs1770Loudness(edge.toReversed()).truePeakDbtp).toBeCloseTo(forward, 2);
  });
});
