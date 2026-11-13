// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The listen DSP's numeric building blocks against NumPy / scipy values and known answers. */
import { describe, expect, it } from 'vitest';
import { log10Exact } from '../../src/listen/dsp/exact-math';
import { autocorrelation, dftInPlace, realFftPlan, rfftPower } from '../../src/listen/dsp/fft';
import { butter4 } from '../../src/listen/dsp/filters';
import { integratedLufs, kPowerOf, loudnessRange } from '../../src/listen/dsp/loudness';
import { timelineLoudness } from '../../src/listen/dsp/loudness-timeline';
import { pyRound, roundTo, stereoOf } from '../../src/listen/dsp/pcm';
import {
  binaryClosing,
  maximumFilter1d,
  medianFilterNearest,
  pairwiseSum,
  percentile,
  uniformFilter1d,
} from '../../src/listen/dsp/stats';
import { truePeakDbtp } from '../../src/listen/dsp/true-peak';
import { mono, noise, silence, SR, stereo, tone } from './dsp-signals';

function naiveDft(x: number[]): Array<[number, number]> {
  return x.map((_, k) => {
    let re = 0;
    let im = 0;
    x.forEach((v, n) => {
      re += v * Math.cos((-2 * Math.PI * k * n) / x.length);
      im += v * Math.sin((-2 * Math.PI * k * n) / x.length);
    });
    return [re, im];
  });
}

describe('FFTs', () => {
  it('match a naive DFT for power-of-two and other lengths', () => {
    for (const n of [8, 12, 31, 64]) {
      const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1));
      const re = Float64Array.from(x);
      const im = new Float64Array(n);
      dftInPlace(re, im);
      naiveDft(x).forEach(([r, i], k) => {
        expect(re[k]).toBeCloseTo(r, 9);
        expect(im[k]).toBeCloseTo(i, 9);
      });
    }
  });

  it('gives a real FFT equal to the complex one, and the linear autocorrelation', () => {
    const x = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i) * (i % 3));
    const plan = realFftPlan(16);
    const re = new Float64Array(9);
    const im = new Float64Array(9);
    plan.transform(x, re, im);
    const p = rfftPower(x, 16);
    for (let k = 0; k < 9; k++) expect((re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2).toBeCloseTo(p[k] ?? 0, 9);
    const ac = autocorrelation([1, 2, 3]);
    expect(Array.from(ac).map((v) => roundTo(v, 9))).toEqual([14, 8, 3]);
  });
});

describe('NumPy and scipy helpers', () => {
  it('match NumPy percentile and ndimage filters', () => {
    expect(percentile([1, 2, 3, 4, 10], 40)).toBeCloseTo(2.6, 12);
    expect(percentile([3, 1, 2], 99)).toBeCloseTo(2.98, 12);
    expect(Array.from(uniformFilter1d([1, 2, 3, 10, 0, 5], 3))).toEqual([
      1.3333333333333333, 2.0, 5.0, 4.333333333333333, 5.0, 3.3333333333333335,
    ]);
    expect(Array.from(maximumFilter1d([1, 5, 2, 0, 3], 3))).toEqual([5, 5, 5, 3, 3]);
    expect(Array.from(medianFilterNearest([5, 1, 4, 2, 8, 0, 3], 3))).toEqual([5, 4, 2, 4, 2, 3, 3]);
    expect(binaryClosing([true, false, true, false, false, false, true], 3)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(
      pairwiseSum(
        Float64Array.from({ length: 300 }, (_, i) => i),
        0,
        300,
      ),
    ).toBe(44_850);
  });

  it('rounds like Python and takes a correctly rounded log10', () => {
    expect([pyRound(0.5), pyRound(1.5), pyRound(2.5), pyRound(-2.5), pyRound(2.6)]).toEqual([0, 2, 2, -2, 3]);
    expect(roundTo(0.125, 2)).toBe(0.12);
    for (const v of [2, 1000, 0.001, 123.456, 7e-12]) expect(log10Exact(v)).toBeCloseTo(Math.log10(v), 14);
    expect(log10Exact(1000)).toBe(3);
  });

  it('designs the same Butterworth sections as scipy.signal.butter', () => {
    const want = {
      low: [
        [
          2.8379052251231635e-8, 5.675810450246327e-8, 2.8379052251231635e-8, -1.9521042830479534,
          0.9527734497375733,
        ],
        [1.0, 2.0, 1.0, -1.9794851879071822, 0.980163740565381],
      ],
      high: [
        [
          0.7094894751253097, -1.4189789502506194, 0.7094894751253097, -1.5590543011416915,
          0.6140517819378818,
        ],
        [1.0, -2.0, 1.0, -1.7577536094827262, 0.8197604429273134],
      ],
    };
    for (const [kind, sections] of [
      ['low', butter4(200, 'low')],
      ['high', butter4(2000, 'high')],
    ] as const) {
      sections.forEach((s, i) => s.forEach((v, j) => expect(v).toBeCloseTo(want[kind][i]?.[j] ?? NaN, 13)));
    }
  });
});

describe('levels', () => {
  it('reads a full-scale 1 kHz sine in both channels as 0 LUFS and its true peak as 0 dBTP', () => {
    const x = stereoOf(mono(tone(1000, 4, 1)));
    expect(integratedLufs(kPowerOf(x))).toBeCloseTo(0, 1);
    expect(truePeakDbtp(x)).toBeCloseTo(0, 1);
  });

  it('finds the inter-sample peak of a quarter-rate sine sampled off its crest', () => {
    const s = tone(12_000, 1, 0.5, Math.PI / 4);
    const x = stereoOf(mono(s));
    // Samples sit at ±0.5·sin(45°) (−9.03 dBFS); the waveform peaks at 0.5 (−6.02 dBTP). earshot's 81-tap
    // Kaiser filter reads 0.12 dB over that at 12 kHz: −5.90535 dBTP from upstream itself.
    expect(truePeakDbtp(x)).toBeCloseTo(-5.90535, 3);
  });

  it('gives null loudness for digital silence and lists it as a whole-file gap', () => {
    const r = timelineLoudness(stereoOf(mono(silence(4))));
    expect(r.integratedLufs).toBeNull();
    expect(r.truePeakDbtp).toBeNull();
    expect(r.digitalSilence).toBe(true);
    expect(r.silences).toEqual([
      expect.objectContaining({ start: 0, end: 4, kind: 'digital silence', where: 'whole file' }),
    ]);
  });

  it('finds a stop-down and clipped runs', () => {
    const a = noise(3, 0.5, 1);
    const b = noise(3, 0.5, 2);
    for (let i = SR; i < 1.6 * SR; i++) a[i] = b[i] = 0;
    for (let i = 2 * SR; i < 2 * SR + 10; i++) a[i] = 1;
    const r = timelineLoudness(stereoOf(stereo(a, b)));
    expect(
      r.silences.some((g) => g.kind === 'digital silence' && Math.abs(g.start - 1) < 0.1 && !g.where),
    ).toBe(true);
    expect(r.clipping.runs).toBe(1);
    expect(r.clipping.times).toEqual([2]);
    expect(loudnessRange(kPowerOf(stereoOf(mono(noise(8, 0.3, 4)))))).toBeLessThan(1);
  });
});
