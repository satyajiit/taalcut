// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * earshot's true peak (features.true_peak_dbtp): `scipy.signal.resample_poly(x, 4, 1)` on both channels, then the
 * largest |sample|. resample_poly's filter is `firwin(81, 1/4, window=('kaiser', 5.0)) · 4`, centred so output
 * sample 4q is input sample q. Taalcut's `mix/true-peak.ts` uses BS.1770 Annex 2's 48-tap filter instead; the two
 * differ by up to a few hundredths of a dB on bright material, so this port keeps earshot's filter (SPEC).
 *
 * Only the maximum is needed, so blocks whose bound (the filter's L1 norm times the block's largest input) cannot
 * beat the best found so far are skipped: the result is exact, and most of a mix is never filtered.
 */
import type { Stereo } from './pcm';
import { db } from './pcm';

const UP = 4;
const HALF = 40;
const TAPS = 2 * HALF + 1;
const BLOCK = 64;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 200; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/** `firwin(81, 0.25, window=('kaiser', 5.0)) * 4`, rounded to float32 as resample_poly does for float32 input. */
function designFilter(): Float64Array {
  const beta = 5;
  const h = new Float64Array(TAPS);
  const alpha = (TAPS - 1) / 2;
  const i0b = besselI0(beta);
  let sum = 0;
  for (let n = 0; n < TAPS; n++) {
    const m = n - alpha;
    const x = 0.25 * m;
    const sinc = m === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = (n - alpha) / alpha;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
    h[n] = 0.25 * sinc * w;
    sum += h[n] ?? 0;
  }
  for (let n = 0; n < TAPS; n++) h[n] = Math.fround(((h[n] ?? 0) / sum) * UP);
  return h;
}

interface Phases {
  /** taps[p][r - rMin[p]] = h[4r + p + 40]. */
  readonly taps: Float64Array[];
  readonly rMin: number[];
  readonly l1: number;
}

let phasesMemo: Phases | undefined;

function phases(): Phases {
  if (phasesMemo) return phasesMemo;
  const h = designFilter();
  const taps: Float64Array[] = [];
  const rMin: number[] = [];
  let l1 = 0;
  for (let p = 0; p < UP; p++) {
    const lo = Math.ceil((-HALF - p) / UP);
    const hi = Math.floor((HALF - p) / UP);
    const t = new Float64Array(hi - lo + 1);
    let norm = 0;
    for (let r = lo; r <= hi; r++) {
      t[r - lo] = h[UP * r + p + HALF] ?? 0;
      norm += Math.abs(t[r - lo] ?? 0);
    }
    l1 = Math.max(l1, norm);
    taps.push(t);
    rMin.push(lo);
  }
  phasesMemo = { taps, rMin, l1 };
  return phasesMemo;
}

/** The largest |y| of the 4× upsampled channel, at least `floor` (blocks that can't beat it are skipped). */
function channelPeak(x: Float32Array, floor: number): number {
  const n = x.length;
  const { taps, rMin, l1 } = phases();
  const blocks = Math.ceil(n / BLOCK);
  const bound = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    // y[4q + p] reads x[q - r], r from rMin to rMin + len - 1: x[q - 10 .. q + 10].
    const from = Math.max(0, b * BLOCK - HALF / UP);
    const to = Math.min(n, (b + 1) * BLOCK + HALF / UP + 1);
    let m = 0;
    for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i] ?? 0));
    bound[b] = m * l1;
  }
  const order = Array.from({ length: blocks }, (_, b) => b).sort((a, b) => (bound[b] ?? 0) - (bound[a] ?? 0));
  let best = floor;
  for (const b of order) {
    if ((bound[b] ?? 0) <= best) break;
    const end = Math.min(n, (b + 1) * BLOCK);
    for (let q = b * BLOCK; q < end; q++) {
      for (let p = 0; p < UP; p++) {
        const t = taps[p] as Float64Array;
        const lo = rMin[p] ?? 0;
        let acc = 0;
        for (let k = 0; k < t.length; k++) {
          const i = q - (lo + k);
          if (i >= 0 && i < n) acc += (t[k] ?? 0) * (x[i] ?? 0);
        }
        const a = Math.abs(acc);
        if (a > best) best = a;
      }
    }
  }
  return best;
}

/** The 4× oversampled peak (linear) over both channels. */
export function truePeakLinear(x: Stereo): number {
  if (x.length === 0) return 0;
  const left = channelPeak(x.left, 0);
  return x.right === x.left ? left : channelPeak(x.right, left);
}

/** `features.true_peak_dbtp`: dBTP, −240 for digital silence (earshot's `db` floor). */
export function truePeakDbtp(x: Stereo): number {
  return db(truePeakLinear(x));
}
