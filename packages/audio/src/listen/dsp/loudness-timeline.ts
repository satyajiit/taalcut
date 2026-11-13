// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The listening timeline's loudness picture (earshot timeline.loudness and `_silences`): momentary and short-term
 * curves floored at the −70 LUFS gate, integrated loudness (null when all is gated out), LRA, true peak (null for
 * digital silence), the loudest moments, gaps and clipped runs. Times are seconds from the start of `x`.
 */
import { kPowerOf, integratedLufs, loudnessCurve, loudnessRange, type KPower } from './loudness';
import { LISTEN_SR, peakOf, roundTo, sliceStereo, type Stereo } from './pcm';
import { binaryClosing, maxOf, runsOf } from './stats';
import { truePeakDbtp } from './true-peak';

export type SilenceKind = 'digital silence' | 'near silence' | 'drop';
export type SilenceWhere = 'whole file' | 'lead-in' | 'tail';

export interface Silence {
  readonly start: number;
  readonly end: number;
  readonly dur: number;
  readonly kind: SilenceKind;
  readonly levelLufs: number;
  /** Set when the gap touches the start or end of the file. */
  readonly where?: SilenceWhere;
}

export interface LoudnessSeries {
  readonly t0: number;
  readonly dt: number;
  readonly lufs: readonly number[];
}

export interface TimelineLoudness {
  readonly integratedLufs: number | null;
  readonly truePeakDbtp: number | null;
  readonly digitalSilence: boolean;
  readonly maxMomentary?: { readonly t: number; readonly lufs: number };
  readonly momentary?: LoudnessSeries;
  readonly maxShortTerm?: { readonly start: number; readonly end: number; readonly lufs: number };
  readonly shortTerm?: LoudnessSeries;
  readonly lraLu: number | null;
  readonly silences: readonly Silence[];
  readonly clipping: { readonly samples: number; readonly runs: number; readonly times: readonly number[] };
}

export interface LoudnessOptions {
  /** `x` begins where the file does: a gap touching it is a lead-in, not a stop-down. Default true. */
  readonly atStart?: boolean;
  /** `x` ends where the file does. Default true. */
  readonly atEnd?: boolean;
  /** The K-weighted sums, when the caller already has them. */
  readonly kPower?: KPower;
}

const floor70 = (v: number) => Math.max(v, -70);

/** timeline.loudness(x). */
export function timelineLoudness(x: Stereo, options: LoudnessOptions = {}): TimelineLoudness {
  const dur = x.length / LISTEN_SR;
  const pk = peakOf(x);
  const k = options.kPower ?? kPowerOf(x);
  let integrated: number | null = null;
  let maxMomentary: TimelineLoudness['maxMomentary'];
  let momentary: LoudnessSeries | undefined;
  if (dur >= 0.4) {
    const { t, lufs } = loudnessCurve(k, 0.4, 0.1);
    const m = Array.from(lufs, floor70);
    const top = maxOf(m);
    if (top > -70) {
      integrated = roundTo(integratedLufs(k), 1);
      maxMomentary = { t: roundTo(t[m.indexOf(top)] ?? 0, 2), lufs: roundTo(top, 1) };
    }
    momentary = { t0: roundTo(t[0] ?? 0, 3), dt: 0.1, lufs: m.map((v) => roundTo(v, 1)) };
  }
  let maxShortTerm: TimelineLoudness['maxShortTerm'];
  let shortTerm: LoudnessSeries | undefined;
  if (dur >= 3.0) {
    const { t, lufs } = loudnessCurve(k, 3.0, 0.5);
    const s = Array.from(lufs, floor70);
    const top = maxOf(s);
    const at = s.indexOf(top);
    if (top > -70) {
      const c = t[at] ?? 0;
      maxShortTerm = { start: roundTo(c - 1.5, 2), end: roundTo(c + 1.5, 2), lufs: roundTo(top, 1) };
    }
    shortTerm = { t0: roundTo(t[0] ?? 0, 3), dt: 0.5, lufs: s.map((v) => roundTo(v, 1)) };
  }
  const lra = dur >= 6 ? loudnessRange(k) : null;
  return {
    integratedLufs: integrated,
    truePeakDbtp: pk > 0 ? roundTo(truePeakDbtp(x), 1) : null,
    digitalSilence: pk === 0,
    ...(maxMomentary ? { maxMomentary } : {}),
    ...(momentary ? { momentary } : {}),
    ...(maxShortTerm ? { maxShortTerm } : {}),
    ...(shortTerm ? { shortTerm } : {}),
    lraLu: lra === null ? null : roundTo(lra, 1),
    silences: silencesOf(x, k, integrated, options.atStart ?? true, options.atEnd ?? true),
    clipping: clippingOf(x),
  };
}

/** timeline._silences: gaps ≥ 0.25 s where the 0.1 s loudness drops 20 LU under the integrated (or −60 LUFS). */
export function silencesOf(
  x: Stereo,
  k: KPower,
  integ: number | null,
  atStart = true,
  atEnd = true,
): Silence[] {
  if (x.length < LISTEN_SR / 2) return [];
  const { t, lufs } = loudnessCurve(k, 0.1, 0.05);
  const f = Array.from(lufs, floor70);
  const thr = integ === null || integ <= -60 ? -70 : Math.max(-60, integ - 20);
  const low = f.map((v) => (integ === null ? v <= thr : v < thr));
  const padded = [low[0] ?? false, low[0] ?? false, low[0] ?? false, ...low];
  const last = low[low.length - 1] ?? false;
  padded.push(last, last, last);
  const closed = binaryClosing(padded, 7).slice(3, -3);
  const mask = closed.map((on, i) => on && (f[i] ?? 0) < thr + 6);
  const dur = x.length / LISTEN_SR;
  const out: Silence[] = [];
  for (const [s, e] of runsOf(mask, 5)) {
    let a = Math.max(0, (t[s] ?? 0) - 0.05);
    let b = Math.min(dur, (t[e - 1] ?? 0) + 0.05);
    if (s === 0) a = 0;
    if (e === f.length) b = dur;
    const seg = sliceStereo(x, Math.trunc(a * LISTEN_SR), Math.trunc(b * LISTEN_SR));
    const pk = seg.length > 0 ? peakOf(seg) : 0;
    let top = -Infinity;
    let sum = 0;
    for (let i = s; i < e; i++) {
      top = Math.max(top, f[i] ?? -70);
      sum += f[i] ?? -70;
    }
    const kind: SilenceKind = pk < 1e-5 ? 'digital silence' : top < -60 ? 'near silence' : 'drop';
    const head = a <= 0.05 && atStart;
    const tail = b >= dur - 0.05 && atEnd;
    const where: SilenceWhere | undefined =
      head || tail ? (head && tail ? 'whole file' : head ? 'lead-in' : 'tail') : undefined;
    out.push({
      start: roundTo(a, 2),
      end: roundTo(b, 2),
      dur: roundTo(b - a, 2),
      kind,
      levelLufs: roundTo(sum / (e - s), 1),
      ...(where ? { where } : {}),
    });
  }
  return out;
}

/** Samples at or over 0.999 (either channel) and runs of at least 3 (the first 20 run starts, seconds). */
export function clippingOf(x: Stereo): TimelineLoudness['clipping'] {
  const clip: boolean[] = new Array<boolean>(x.length);
  let samples = 0;
  for (let i = 0; i < x.length; i++) {
    const on = Math.max(Math.abs(x.left[i] ?? 0), Math.abs(x.right[i] ?? 0)) >= 0.999;
    clip[i] = on;
    if (on) samples++;
  }
  const runs = runsOf(clip, 3);
  return { samples, runs: runs.length, times: runs.slice(0, 20).map(([s]) => roundTo(s / LISTEN_SR, 3)) };
}
