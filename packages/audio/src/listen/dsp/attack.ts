// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * From an onset frame to the attack an editor would align on (earshot timeline `_attack`, `_length_ms`,
 * `_excess_centroid`): in each band's 1 ms envelope, the event's peak within −15..+50 ms, its bed (the median of
 * 160 to 40 ms before), then back from the peak to the first millisecond within 20 dB of it above the bed. The band
 * where the event stands out most names it; the timing comes from the full band whenever it rises 12 dB there too
 * (filtered bands smear time).
 */
import type { BandEnvelopes, EnvelopeBand } from './envelopes';
import { hanningSymmetric, rfftPower } from './fft';
import { LISTEN_SR, pyRound } from './pcm';
import { argMax, median } from './stats';

/** timeline.BED_FLOOR: beds quieter than −80 dBFS count as −80. */
export const BED_FLOOR = 10 ** (-80 / 20);

export interface BandAttack {
  /** Peak over bed. */
  readonly ratio: number;
  readonly band: EnvelopeBand;
  /** The attack (ms index). */
  readonly j: number;
  /** The peak (ms index). */
  readonly ip: number;
  readonly bed: number;
}

export interface Attack {
  readonly ratio: number;
  readonly band: EnvelopeBand;
  readonly timing: BandAttack;
}

const ORDER: readonly EnvelopeBand[] = ['full', 'low', 'high'];

/** Python's max over (ratio, band, j, ip, bed) tuples. */
function larger(a: BandAttack, b: BandAttack): boolean {
  if (a.ratio !== b.ratio) return a.ratio > b.ratio;
  if (a.band !== b.band) return a.band > b.band;
  if (a.j !== b.j) return a.j > b.j;
  if (a.ip !== b.ip) return a.ip > b.ip;
  return a.bed > b.bed;
}

/** timeline._attack(envs, tc); null when no band has 5 ms around the frame. */
export function refineAttack(envs: BandEnvelopes, tc: number): Attack | null {
  const ic = pyRound(tc * 1000);
  const res = new Map<EnvelopeBand, BandAttack>();
  for (const band of ORDER) {
    const e = envs[band];
    const a = Math.max(0, ic - 15);
    const b = Math.min(e.length, ic + 50);
    if (b - a < 5) continue;
    const ip = argMax(e, a, b);
    const preFrom = Math.max(0, ic - 160);
    const preTo = Math.max(0, ic - 40);
    const pre =
      preTo - preFrom >= 20 ? e.subarray(preFrom, preTo) : e.subarray(0, Math.min(e.length, ic + 250));
    const bed = Math.max(median(pre), BED_FLOOR);
    const peak = e[ip] ?? 0;
    const thr = bed + 0.1 * (peak - bed);
    let j = ip;
    const lo = Math.max(0, ic - 40);
    while (j > lo && (e[j - 1] ?? 0) >= thr) j--;
    res.set(band, { ratio: peak / bed, band, j, ip, bed });
  }
  let best: BandAttack | undefined;
  for (const v of res.values()) if (!best || larger(v, best)) best = v;
  if (!best) return null;
  const full = res.get('full');
  const timing = full && full.ratio >= 4.0 ? full : best;
  return { ratio: best.ratio, band: best.band, timing };
}

/**
 * timeline._length_ms: from the attack until the envelope falls 20 dB below the peak or back to 3 dB over its bed
 * and stays there for 30 ms; capped at 2 s.
 */
export function eventLengthMs(e: Float64Array, i0: number, ip: number, bed: number): number {
  const floor = Math.max((e[ip] ?? 0) * 0.1, bed * 1.41);
  const segLength = Math.max(0, Math.min(e.length, ip + 2000) - ip);
  let k = segLength;
  let run = 0;
  for (let i = 0; i < segLength; i++) {
    run = (e[ip + i] ?? 0) < floor ? run + 1 : 0;
    if (run === 30) {
      k = i - 29;
      break;
    }
  }
  return Math.trunc(Math.min(ip + k - i0, 2000));
}

function windowedPower(seg: Float32Array): Float64Array {
  const w = hanningSymmetric(seg.length);
  const x = new Float64Array(seg.length);
  for (let i = 0; i < seg.length; i++) x[i] = (seg[i] ?? 0) * (w[i] ?? 0);
  const p = rfftPower(x, 4096);
  for (let k = 0; k < p.length; k++) p[k] = (p[k] ?? 0) / seg.length;
  return p;
}

/** timeline._excess_centroid: the spectral centroid (Hz) of what the event adds over the bed just before it. */
export function excessCentroidHz(m: Float32Array, t: number, lengthS: number): number | null {
  const a = Math.trunc(t * LISTEN_SR);
  const n = Math.trunc(Math.min(Math.max(lengthS, 0.03), 0.12) * LISTEN_SR);
  const seg = m.subarray(Math.min(a, m.length), Math.min(a + n, m.length));
  const pre = m.subarray(
    Math.max(0, a - Math.trunc(0.15 * LISTEN_SR)),
    Math.max(0, a - Math.trunc(0.01 * LISTEN_SR)),
  );
  if (seg.length < 256) return null;
  let p = windowedPower(seg);
  if (pre.length >= 256) {
    const q = windowedPower(pre);
    const x = new Float64Array(p.length);
    let sx = 0;
    let sp = 0;
    for (let k = 0; k < p.length; k++) {
      x[k] = Math.max((p[k] ?? 0) - (q[k] ?? 0), 0);
      sx += x[k] ?? 0;
      sp += p[k] ?? 0;
    }
    if (sx > 0.2 * sp) p = x;
  }
  const df = 1 / (4096 * (1 / LISTEN_SR));
  let num = 0;
  let den = 0;
  for (let k = 0; k < p.length; k++) {
    const f = k * df;
    if (f >= 20 && f <= 20_000) {
      num += f * (p[k] ?? 0);
      den += p[k] ?? 0;
    }
  }
  return Math.trunc(num / (den + 1e-30));
}
