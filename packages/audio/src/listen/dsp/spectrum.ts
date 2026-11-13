// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The whole-file spectrum earshot measures (features.measure): Welch's PSD (scipy: periodic Hann, half overlap,
 * each segment's mean removed, density scaling, one-sided) over segments of up to 65,536 samples, and what is read
 * from it: centroid, 95 % roll-off, band shares, bandwidth, flatness and the tonal peak ratio; plus brightness, the
 * median magnitude-weighted centroid of 1024-point STFT frames within 30 dB of the loudest. Long segments run on
 * the four-step FFT graph; a sound shorter than 1024 samples, or one whose single segment is not a power of two
 * long (under 1.4 s), is one transform on the CPU.
 */
import { hannPeriodic, isPowerOfTwo } from './fft';
import { roundTo } from './pcm';
import type { SpectrogramRunner } from './spectrogram-graph';
import { oracleSegmentPower } from './spectrogram-oracle';
import { binFreqs, brightnessSpec } from './spectra';
import { median, searchSorted } from './stats';
import { frameSignal } from './transforms';

/** features.BANDS, Hz. */
export const MEASURE_BANDS = {
  sub: [20, 60],
  low: [60, 250],
  lowmid: [250, 1000],
  mid: [1000, 4000],
  presence: [4000, 8000],
  air: [8000, 16_000],
  top: [16_000, 24_000],
} as const;
export type MeasureBand = keyof typeof MEASURE_BANDS;

export interface SpectrumMeasures {
  readonly centroidHz: number;
  readonly rolloff95Hz: number;
  readonly bandsDb: Readonly<Record<MeasureBand, number>>;
  readonly bandwidthHz: number | null;
  readonly flatness: number;
  readonly tonalPeakRatioDb: number;
}

/** scipy.signal.welch(m, 48000, nperseg) as earshot calls it: the PSD and its frequencies. */
export async function welchPsd(
  m: Float64Array,
  runner: SpectrogramRunner,
): Promise<{ f: Float64Array; p: Float64Array }> {
  const n = m.length;
  const nfft = 2 ** Math.min(16, Math.max(10, Math.ceil(Math.log2(Math.max(1024, Math.min(n, 65_536))))));
  const per = Math.min(nfft, n);
  const overlap = Math.floor(per / 2);
  const hop = per - overlap;
  const count = Math.floor((n - overlap) / hop);
  const w = hannPeriodic(per);
  let w2 = 0;
  for (const v of w) w2 += v * v;
  const segments = new Float32Array(count * per);
  const segments64 = isPowerOfTwo(per) && per >= 1024 ? undefined : new Float64Array(count * per);
  for (let s = 0; s < count; s++) {
    let sum = 0;
    for (let i = 0; i < per; i++) sum += m[s * hop + i] ?? 0;
    const mu = sum / per;
    for (let i = 0; i < per; i++) {
      const v = ((m[s * hop + i] ?? 0) - mu) * (w[i] ?? 0);
      segments[s * per + i] = v;
      if (segments64) segments64[s * per + i] = v;
    }
  }
  const raw = segments64
    ? oracleSegmentPower(segments64, count, per)
    : (await runner.segmentPower(segments, count, per)).power;
  const bins = Math.floor(per / 2) + 1;
  const p = new Float64Array(bins);
  const scale = 1 / (48_000 * w2);
  for (let k = 0; k < bins; k++) {
    let acc = 0;
    for (let s = 0; s < count; s++) acc += raw[s * bins + k] ?? 0;
    const doubled = k > 0 && (per % 2 === 1 || k < bins - 1) ? 2 : 1;
    p[k] = (acc / count) * scale * doubled + 1e-30;
  }
  return { f: binFreqs(per, bins), p };
}

/** What features.measure reads from the Welch PSD (P already has its 1e-30 floor). */
export function spectrumMeasures(f: Float64Array, p: Float64Array): SpectrumMeasures {
  let tot = 0;
  let fp = 0;
  let maxP = 0;
  let logSum = 0;
  for (let k = 0; k < p.length; k++) {
    const v = p[k] ?? 0;
    tot += v;
    fp += (f[k] ?? 0) * v;
    maxP = Math.max(maxP, v);
    logSum += Math.log(v);
  }
  let c = 0;
  let roll = p.length - 1;
  for (let k = 0; k < p.length; k++) {
    c += p[k] ?? 0;
    if (c / tot >= 0.95) {
      roll = k;
      break;
    }
  }
  const bandsDb = Object.fromEntries(
    Object.entries(MEASURE_BANDS).map(([name, [a, b]]) => {
      let s = 0;
      for (let k = 0; k < p.length; k++) if ((f[k] ?? 0) >= a && (f[k] ?? 0) < b) s += p[k] ?? 0;
      return [name, roundTo(10 * Math.log10(s / tot + 1e-12), 1)];
    }),
  ) as Record<MeasureBand, number>;
  const edges = Array.from({ length: 31 }, (_, i) => 20 * 2 ** (i / 3));
  const lv = edges.slice(0, -1).map((a, i) => {
    const b = edges[i + 1] ?? 0;
    let s = 0;
    let n = 0;
    for (let k = searchSorted(f, a); k < p.length && (f[k] ?? 0) < b; k++) {
      s += p[k] ?? 0;
      n++;
    }
    return n > 0 ? 10 * Math.log10(s / n) : -300;
  });
  const lvMax = Math.max(...lv);
  let lastOk = -1;
  lv.forEach((v, i) => {
    if (v >= lvMax - 60) lastOk = i;
  });
  return {
    centroidHz: Math.trunc(fp / tot),
    rolloff95Hz: Math.trunc(f[Math.min(p.length - 1, roll)] ?? 0),
    bandsDb,
    bandwidthHz: lastOk >= 0 ? Math.trunc(edges[lastOk + 1] ?? 0) : null,
    flatness: roundTo(Math.exp(logSum / p.length) / (tot / p.length), 4),
    tonalPeakRatioDb: roundTo(10 * Math.log10(maxP / median(p)), 1),
  };
}

/** features.brightness_hz: null under 1024 samples or with no active frame. */
export async function brightnessHz(m: Float32Array, runner: SpectrogramRunner): Promise<number | null> {
  if (m.length < 1024) return null;
  const nadd = (((-(m.length - 1024) % 256) + 256) % 256) % 1024;
  const padded = new Float32Array(m.length + nadd);
  padded.set(m);
  const out = await runner.spectrogram(brightnessSpec(), frameSignal(padded, 1024, 256));
  let top = 0;
  for (let i = 0; i < out.frames; i++) top = Math.max(top, out.data[i * 2] ?? 0);
  const centroids: number[] = [];
  for (let i = 0; i < out.frames; i++) {
    const e = out.data[i * 2] ?? 0;
    if (e >= top * 10 ** (-30 / 20)) centroids.push((out.data[i * 2 + 1] ?? 0) / (e + 1e-20));
  }
  return centroids.length > 0 ? Math.trunc(median(centroids)) : null;
}
