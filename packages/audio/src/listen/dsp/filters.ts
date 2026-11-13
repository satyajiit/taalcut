// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The IIR filters earshot runs through scipy: 4th-order Butterworth band splits (`butter(4, f, kind, fs=48000,
 * output='sos')`, then `sosfilt`) and the BS.1770 K-weighting (`lfilter` with the 48 kHz coefficients). Both are
 * transposed direct form II from rest, as scipy's. Taalcut's `bs1770-loudnorm.ts` has the same K-weighting stages;
 * they are restated here so this port's loudness follows earshot's block rules exactly (see the SPEC).
 */
import { LISTEN_SR } from './pcm';

/** One biquad section `[b0, b1, b2, a1, a2]` (a0 = 1). */
export type Section = readonly [number, number, number, number, number];

/** BS.1770 K-weighting at 48 kHz (earshot features._kw, polish.K_SOS). */
export const K_WEIGHTING: readonly Section[] = [
  [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
  [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621],
];

/** `scipy.signal.butter(4, cutoff, kind, fs=48000, output='sos')`: sections in zpk2sos's 'nearest' order. */
export function butter4(cutoff: number, kind: 'low' | 'high', fs = LISTEN_SR): Section[] {
  const order = 4;
  // iirfilter: Wn normalised to fs = 2, then pre-warped.
  const wn = (2 * cutoff) / fs;
  const fs2 = 2;
  const warped = 2 * fs2 * Math.tan((Math.PI * wn) / fs2);
  // buttap: p = -exp(i·π·m / (2N)), m = -N+1, -N+3, …, N-1.
  const poles: Array<[number, number]> = [];
  for (let m = -order + 1; m < order; m += 2) {
    const angle = (Math.PI * m) / (2 * order);
    poles.push([-Math.cos(angle), -Math.sin(angle)]);
  }
  const analog = poles.map(([re, im]): [number, number] => {
    if (kind === 'low') return [re * warped, im * warped];
    // lp2hp: p → wo / p.
    const mag = re * re + im * im;
    return [(warped * re) / mag, (-warped * im) / mag];
  });
  // bilinear: z = (2fs + s) / (2fs - s), with fs = 2.
  const k2 = 2 * fs2;
  const digital = analog.map(([re, im]): [number, number] => {
    const nr = k2 + re;
    const ni = im;
    const dr = k2 - re;
    const di = -im;
    const den = dr * dr + di * di;
    return [(nr * dr + ni * di) / den, (ni * dr - nr * di) / den];
  });
  // Gain: real(prod(2fs - z_a) / prod(2fs - p_a)) · k_a.
  let gr = 1;
  let gi = 0;
  for (const [re, im] of analog) {
    const dr = k2 - re;
    const di = -im;
    const nr = gr * dr - gi * di;
    gi = gr * di + gi * dr;
    gr = nr;
  }
  const den = gr * gr + gi * gi;
  const inv = gr / den;
  const gain = kind === 'low' ? warped ** order * inv : k2 ** order * inv;
  // Conjugate pairs; the pair nearest the unit circle goes last (zpk2sos 'nearest').
  const upper = digital.filter(([, im]) => im > 0);
  upper.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  const zero = kind === 'low' ? 2 : -2;
  return upper.map(([re, im], index): Section => {
    const a1 = -2 * re;
    const a2 = re * re + im * im;
    const g = index === 0 ? gain : 1;
    return [g, g * zero, g, a1, a2];
  });
}

/** `scipy.signal.sosfilt` from rest, in float64. */
export function sosfilt(sections: readonly Section[], input: ArrayLike<number>): Float64Array {
  let x: ArrayLike<number> = input;
  let out = new Float64Array(input.length);
  for (const [b0, b1, b2, a1, a2] of sections) {
    out = new Float64Array(input.length);
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i] ?? 0;
      const y = b0 * xi + z1;
      z1 = b1 * xi - a1 * y + z2;
      z2 = b2 * xi - a2 * y;
      out[i] = y;
    }
    x = out;
  }
  return out;
}

/**
 * earshot's band filters run on a reflected 100 ms lead-in so they start without a transient:
 * `concat(m[pad:0:-1], m)` with `pad = min(len - 1, SR // 10)`; the result drops the lead-in.
 */
export function filterWithLeadIn(sections: readonly Section[], m: ArrayLike<number>): Float64Array {
  const n = m.length;
  const pad = Math.max(0, Math.min(n - 1, LISTEN_SR / 10));
  const padded = new Float64Array(pad + n);
  for (let i = 0; i < pad; i++) padded[i] = m[pad - i] ?? 0;
  for (let i = 0; i < n; i++) padded[pad + i] = m[i] ?? 0;
  return sosfilt(sections, padded).subarray(pad);
}

/** K-weighted copy of one channel (float64). */
export function kWeight(channel: ArrayLike<number>): Float64Array {
  return sosfilt(K_WEIGHTING, channel);
}
