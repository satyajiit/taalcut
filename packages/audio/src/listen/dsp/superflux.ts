// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Superflux onsets (earshot timeline.onset_curve and the picking in detect_events): the 96-band log-mel (graph) is
 * floored 80 dB under its maximum; each band's rise over the largest of its neighbouring bands two frames (10 ms)
 * earlier, half-wave rectified and averaged over bands, is the onset strength at 5 ms frames. A frame is an onset
 * candidate when it is the largest within ±5 frames, at least 3 robust SDs over the median of the surrounding 2 s
 * (401 frames, median/MAD), and above zero. Peak picking is CPU work, as with Beat This!.
 */
import { LISTEN_SR } from './pcm';
import type { SpectrogramRunner } from './spectrogram-graph';
import { superfluxSpec } from './spectra';
import { maximumFilter1d, medianFilterNearest, percentile } from './stats';
import { centredFrames } from './transforms';

/** timeline.HOP: the onset detector's frame hop, 5 ms. */
export const ONSET_HOP = 240;
const BANDS = 96;

export interface LogMel {
  /** Row-major [frames, 96], dB. */
  readonly data: Float32Array;
  readonly frames: number;
  readonly backend: string;
}

/** timeline.log_mel(m) on the runner (frames centred at i·5 ms). */
export async function superfluxLogMel(mono: ArrayLike<number>, runner: SpectrogramRunner): Promise<LogMel> {
  const spec = superfluxSpec();
  const out = await runner.spectrogram(spec, centredFrames(mono, 1024, ONSET_HOP));
  return { data: out.data, frames: out.frames, backend: out.backend };
}

/** timeline.onset_curve from a log-mel: dB per frame, two leading zeros. */
export function onsetCurve(mel: LogMel): Float64Array {
  const { data, frames } = mel;
  let top = -Infinity;
  for (let i = 0; i < data.length; i++) top = Math.max(top, data[i] ?? -Infinity);
  const floor = top - 80;
  const l = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) l[i] = Math.max(data[i] ?? floor, floor);
  const odf = new Float64Array(frames);
  for (let t = 2; t < frames; t++) {
    const prev = (t - 2) * BANDS;
    const row = t * BANDS;
    let sum = 0;
    for (let b = 0; b < BANDS; b++) {
      // maximum_filter1d(L, 3, axis=0), mode reflect: the band and its neighbours, the edge band repeated.
      const lo = l[prev + Math.max(0, b - 1)] ?? 0;
      const mid = l[prev + b] ?? 0;
      const hi = l[prev + Math.min(BANDS - 1, b + 1)] ?? 0;
      const d = (l[row + b] ?? 0) - Math.max(lo, mid, hi);
      if (d > 0) sum += d;
    }
    odf[t] = sum / BANDS;
  }
  return odf;
}

/** timeline._robust_z: (v − median) / (1.4826·MAD + 2 % of the 99th percentile of the positive values), over `size`. */
export function robustZ(v: Float64Array, size = 401): Float64Array {
  const med = medianFilterNearest(v, size);
  const dev = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) dev[i] = Math.abs((v[i] ?? 0) - (med[i] ?? 0));
  const mad = medianFilterNearest(dev, size);
  const pos = Array.from(v).filter((x) => x > 0);
  const floor = pos.length > 0 ? 0.02 * percentile(pos, 99) : 1e-6;
  const z = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++)
    z[i] = ((v[i] ?? 0) - (med[i] ?? 0)) / ((mad[i] ?? 0) * 1.4826 + floor + 1e-9);
  return z;
}

/** The picked frames: local maxima over 11 frames with z ≥ `zThreshold` and strength above zero. */
export function pickOnsets(odf: Float64Array, z: Float64Array, zThreshold = 3.0): number[] {
  const local = maximumFilter1d(odf, 11);
  const out: number[] = [];
  for (let i = 0; i < odf.length; i++) {
    const v = odf[i] ?? 0;
    if (v === local[i] && (z[i] ?? 0) >= zThreshold && v > 0) out.push(i);
  }
  return out;
}

/** Frame index → seconds (frame i is centred at i·5 ms). */
export const onsetFrameTime = (i: number): number => (i * ONSET_HOP) / LISTEN_SR;
