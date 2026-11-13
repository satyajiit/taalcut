// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What sections.ts needs from timeline.py's DSP: the coarse log-mel (2048-point frames every 50 ms, 40 HTK bands
 * 30 Hz – 16 kHz, dB), Foote novelty on 0.5 s frames (a checkerboard kernel ±4 s, peaks with a robust z ≥ 3), and
 * the boundary refinement (the strongest 1 s-against-1 s spectral change near a coarse boundary). It is a few
 * thousand small FFTs per minute of sound, so it runs on the CPU in f64, like Beat This!'s peak picking.
 */
import { roundTo } from '../calibrate/verdict';
import { LISTEN_CONFIG } from '../config';
import { createRealFft } from '../models/fft';

const SR = LISTEN_CONFIG.sampleRate;
const N_FFT = 2048;
const HOP = 2400;
const N_MELS = 40;
const F_MIN = 30;
const F_MAX = 16_000;

let bank: Float64Array[] | undefined;

/** timeline._mel_fb: HTK triangles over rfftfreq, `[mels][bins]`. */
function melBank(): Float64Array[] {
  if (bank) return bank;
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const lo = mel(F_MIN);
  const hi = mel(F_MAX);
  const edges = Array.from({ length: N_MELS + 2 }, (_, i) => {
    const m = i === N_MELS + 1 ? hi : lo + ((hi - lo) * i) / (N_MELS + 1);
    return 700 * (10 ** (m / 2595) - 1);
  });
  const bins = N_FFT / 2 + 1;
  bank = Array.from({ length: N_MELS }, (_, m) => {
    const [a, c, b] = [edges[m] ?? 0, edges[m + 1] ?? 0, edges[m + 2] ?? 0];
    return Float64Array.from({ length: bins }, (__, k) => {
      const f = (k * SR) / N_FFT;
      return Math.max(0, Math.min((f - a) / (c - a), (b - f) / (b - c)));
    });
  });
  return bank;
}

/** timeline.log_mel(m, 2048, 2400, 40): `[frames][40]` dB, frame i centred at i·50 ms. */
export function coarseLogMel(signal: Float32Array): Float64Array[] {
  const pad = N_FFT / 2;
  const reflect = signal.length > N_FFT;
  const length = signal.length + 2 * pad;
  const at = (i: number): number => {
    const j = i - pad;
    if (j >= 0 && j < signal.length) return signal[j] ?? 0;
    if (!reflect) return 0;
    return signal[j < 0 ? -j : 2 * (signal.length - 1) - j] ?? 0;
  };
  const frames = length >= N_FFT ? 1 + Math.floor((length - N_FFT) / HOP) : 0;
  const window = Float64Array.from(
    { length: N_FFT },
    (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N_FFT - 1)),
  );
  const fft = createRealFft(N_FFT);
  const buffer = new Float64Array(N_FFT);
  const power = new Float64Array(N_FFT / 2 + 1);
  const filters = melBank();
  const out: Float64Array[] = [];
  for (let f = 0; f < frames; f++) {
    for (let n = 0; n < N_FFT; n++) buffer[n] = at(f * HOP + n) * (window[n] ?? 0);
    fft.power(buffer, power);
    out.push(
      Float64Array.from(
        filters,
        (row) => 10 * Math.log10(row.reduce((s, w, k) => s + w * (power[k] ?? 0), 0) + 1e-12),
      ),
    );
  }
  return out;
}

/** scipy.ndimage.median_filter(v, size, mode='nearest'): window [i − ⌊size/2⌋, i + size − 1 − ⌊size/2⌋], upper median. */
function medianFilter(v: Float64Array, size: number): Float64Array {
  const half = Math.floor(size / 2);
  const last = v.length - 1;
  return Float64Array.from(v, (_, i) => {
    const window: number[] = [];
    for (let j = i - half; j <= i + size - 1 - half; j++) window.push(v[Math.min(last, Math.max(0, j))] ?? 0);
    window.sort((a, b) => a - b);
    return window[half] ?? 0;
  });
}

/** NumPy's percentile, linear. */
function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (q / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (pos - lo);
}

/** timeline._robust_z(v, size). */
export function robustZ(v: Float64Array, size: number): Float64Array {
  const med = medianFilter(v, size);
  const mad = medianFilter(
    Float64Array.from(v, (x, i) => Math.abs(x - (med[i] ?? 0))),
    size,
  ).map((x) => x * 1.4826);
  const positive = [...v].filter((x) => x > 0);
  const floor = positive.length > 0 ? 0.02 * percentile(positive, 99) : 1e-6;
  return Float64Array.from(v, (x, i) => (x - (med[i] ?? 0)) / ((mad[i] ?? 0) + floor + 1e-9));
}

/** timeline.novelty_bounds: [(time s, z)] of novelty peaks at least the kernel apart, z ≥ `threshold`. */
export function noveltyBounds(
  signal: Float32Array,
  threshold: number = LISTEN_CONFIG.sections.noveltyZ,
  kernelS: number = LISTEN_CONFIG.sections.noveltyKernelS,
): [number, number][] {
  const mel = coarseLogMel(signal);
  const n = Math.floor(mel.length / 10);
  const w = Math.trunc(kernelS / 0.5);
  if (n < 4 * w) return [];
  const F = Array.from({ length: N_MELS }, (_, b) =>
    Float64Array.from({ length: n }, (__, i) => {
      let s = 0;
      for (let k = 0; k < 10; k++) s += mel[i * 10 + k]?.[b] ?? 0;
      return s / 10;
    }),
  );
  for (const row of F) {
    const mean = row.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(row.reduce((s, v) => s + (v - mean) ** 2, 0) / n) + 1e-6;
    row.forEach((v, i) => (row[i] = (v - mean) / std));
  }
  for (let i = 0; i < n; i++) {
    const norm = Math.sqrt(F.reduce((s, row) => s + (row[i] ?? 0) ** 2, 0)) + 1e-9;
    for (const row of F) row[i] = (row[i] ?? 0) / norm;
  }
  const sim = (i: number, j: number) => F.reduce((s, row) => s + (row[i] ?? 0) * (row[j] ?? 0), 0);
  const g = Array.from({ length: 2 * w }, (_, k) => Math.exp((-0.5 * (k - w + 0.5) ** 2) / (0.5 * w) ** 2));
  const sign = (k: number) => (k < w ? -1 : 1);
  const nov = new Float64Array(n);
  for (let i = w; i < n - w; i++) {
    let sum = 0;
    for (let a = 0; a < 2 * w; a++)
      for (let b = 0; b < 2 * w; b++)
        sum += sign(a) * sign(b) * (g[a] ?? 0) * (g[b] ?? 0) * sim(i - w + a, i - w + b);
    nov[i] = sum;
  }
  const z = robustZ(nov, n);
  const peaks: [number, number][] = [];
  for (let i = w; i < n - w; i++) {
    let max = Number.NEGATIVE_INFINITY;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) max = Math.max(max, nov[j] ?? 0);
    if (nov[i] === max && (z[i] ?? 0) >= threshold) {
      peaks.push([roundTo(i * 0.5, 2), roundTo(z[i] ?? 0, 1)]);
    }
  }
  return peaks;
}

/** timeline._novelty_refine: the strongest change within ±radius of `t` (s), rounded to 0.01 s. */
export function refineBoundary(signal: Float32Array, t: number, radius: number): number {
  const a = Math.max(0, t - radius - 1);
  const b = Math.min(signal.length / SR, t + radius + 1);
  const segment = signal.subarray(Math.trunc(a * SR), Math.trunc(b * SR));
  if (segment.length < 2 * SR) return t;
  const mel = coarseLogMel(segment);
  let best = -1;
  let bestT = t;
  for (let k = 10; k < mel.length - 10; k++) {
    const tt = a + k * 0.05;
    if (Math.abs(tt - t) > radius) continue;
    let d = 0;
    for (let m = 0; m < N_MELS; m++) {
      let left = 0;
      let right = 0;
      for (let j = 0; j < 10; j++) {
        left += mel[k - 10 + j]?.[m] ?? 0;
        right += mel[k + j]?.[m] ?? 0;
      }
      d += ((left - right) / 10) ** 2;
    }
    if (Math.sqrt(d) > best) [best, bestT] = [Math.sqrt(d), tt];
  }
  return roundTo(bestT, 2);
}
