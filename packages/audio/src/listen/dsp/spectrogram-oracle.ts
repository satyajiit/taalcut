// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The CPU side of every listen spectrogram, in float64: the reference the graph tests compare against and the
 * logged fallback when no accelerator opens. A DFT transform goes through an FFT (not the graph's basis, so a
 * wrong basis can't pass both sides); a filter bank through direct inner products. Long single spectra (Welch
 * segments) are plain FFTs of any length.
 */
import { dftInPlace, isPowerOfTwo, realFftPlan, type RealFftPlan } from './fft';
import {
  outputColumns,
  transformBins,
  type FrameBlock,
  type SpectrogramResult,
  type SpectrogramSpec,
} from './transforms';

const DB = 10 / Math.LN10;

function dftRows(spec: SpectrogramSpec, block: FrameBlock, re: Float64Array, im: Float64Array): void {
  const t = spec.transform;
  if (t.kind !== 'dft') return;
  const length = spec.frameLength;
  const bins = t.bins;
  const input = new Float64Array(t.nFft);
  const plan: RealFftPlan | undefined = isPowerOfTwo(t.nFft) && t.nFft >= 4 ? realFftPlan(t.nFft) : undefined;
  const half = Math.floor(t.nFft / 2) + 1;
  const fr = new Float64Array(plan ? half : t.nFft);
  const fi = new Float64Array(plan ? half : t.nFft);
  for (let f = 0; f < block.count; f++) {
    input.fill(0);
    for (let n = 0; n < length; n++) input[n] = (block.frames[f * length + n] ?? 0) * (t.window[n] ?? 0);
    if (plan) {
      plan.transform(input, fr, fi);
    } else {
      fr.set(input);
      fi.fill(0);
      dftInPlace(fr, fi);
    }
    for (let b = 0; b < bins; b++) {
      re[f * bins + b] = fr[t.firstBin + b] ?? 0;
      im[f * bins + b] = fi[t.firstBin + b] ?? 0;
    }
  }
}

function filterRows(spec: SpectrogramSpec, block: FrameBlock, re: Float64Array, im: Float64Array): void {
  const t = spec.transform;
  if (t.kind !== 'filters') return;
  const length = spec.frameLength;
  const bins = t.re.length;
  for (let f = 0; f < block.count; f++) {
    const row = f * length;
    for (let b = 0; b < bins; b++) {
      const wr = t.re[b] as Float64Array;
      const wi = t.im[b] as Float64Array;
      let sr = 0;
      let si = 0;
      for (let n = 0; n < length; n++) {
        const x = block.frames[row + n] ?? 0;
        sr += x * (wr[n] ?? 0);
        si -= x * (wi[n] ?? 0);
      }
      re[f * bins + b] = sr;
      im[f * bins + b] = si;
    }
  }
}

/** The spectrogram of `block` in float64, returned in float32 like the graph's. */
export function oracleSpectrogram(spec: SpectrogramSpec, block: FrameBlock): SpectrogramResult {
  const bins = transformBins(spec.transform);
  const re = new Float64Array(block.count * bins);
  const im = new Float64Array(block.count * bins);
  if (spec.transform.kind === 'dft') dftRows(spec, block, re, im);
  else filterRows(spec, block, re, im);
  const columns = outputColumns(spec);
  const data = new Float32Array(block.count * columns);
  const value = new Float64Array(bins);
  const p = spec.projection;
  for (let f = 0; f < block.count; f++) {
    for (let b = 0; b < bins; b++) {
      const power = (re[f * bins + b] ?? 0) ** 2 + (im[f * bins + b] ?? 0) ** 2;
      value[b] = spec.output === 'magnitude' ? Math.sqrt(power) : power;
    }
    for (let c = 0; c < columns; c++) {
      let v: number;
      if (p) {
        v = 0;
        for (let b = 0; b < bins; b++) v += (value[b] ?? 0) * (p.data[b * p.columns + c] ?? 0);
      } else {
        v = value[c] ?? 0;
      }
      data[f * columns + c] = spec.output === 'db' ? DB * Math.log(v + 1e-12) : v;
    }
  }
  return { data, frames: block.count, columns, backend: 'cpu' };
}

/** One-sided power |X_k|², k = 0..n/2, of each of `count` real segments of length `n` (row-major). */
export function oracleSegmentPower(
  segments: Float64Array | Float32Array,
  count: number,
  n: number,
): Float64Array {
  const half = Math.floor(n / 2) + 1;
  const out = new Float64Array(count * half);
  const plan = isPowerOfTwo(n) && n >= 4 ? realFftPlan(n) : undefined;
  const re = new Float64Array(plan ? half : n);
  const im = new Float64Array(plan ? half : n);
  for (let s = 0; s < count; s++) {
    const seg = segments.subarray(s * n, (s + 1) * n);
    if (plan) {
      plan.transform(seg, re, im);
    } else {
      re.set(seg);
      im.fill(0);
      dftInPlace(re, im);
    }
    for (let k = 0; k < half; k++) out[s * half + k] = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
  }
  return out;
}
