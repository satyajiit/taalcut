// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The level envelopes earshot's `find` reads (search.py at ff41f07): RMS dB over 5 ms (and 1 ms) frames of the
 * 48 kHz mono, and the edge tests on it: how loud a segment's first 5 ms and last 10 ms are against its peak, edit
 * gaps (≥ 10 ms of exact digital silence between takes), the quiet level (40 dB under the peak, or 6 dB over the
 * floor) and whether a stretch holds two separate sounds. Frame indices follow Python's `int()` (truncation) and
 * `round()` (ties to even) exactly as upstream writes them, so a segment's edges land on the same frames.
 */
import { pyRound } from '../dsp/pcm';
import { maxOf, pairwiseSum } from '../dsp/stats';
import { LISTEN_CONFIG } from '../config';

const SR = LISTEN_CONFIG.sampleRate;

export const FIND = {
  /** search.FRAME: the envelope's frame, s. */
  frame: 0.005,
  preRoll: 0.005,
  /** Read from this much before a range's start, so an attack on the boundary is seen whole. */
  margin: 0.1,
  /** The longest stroke or event, s. */
  capS: 2.0,
  mergeGap: 0.25,
  decayDb: 35,
  maxEvents: 48,
  maxWindows: 40,
  maxWinS: 10,
  singleStageS: 60,
  topWindows: 6,
  bucketS: 2,
  refineDz: 0.5,
  weakDb: 15,
  cutDb: -15,
  tailPenalty: 0.5,
  editDb: -100,
  editS: 0.01,
  snapS: 1.0,
  quietDb: 40,
  /** From upstream's labelled tuning phrasings: one-shot at or above, continuous at or below. */
  kindEvent: -0.08,
  kindTexture: -0.27,
} as const;

const F = FIND.frame;
/** Python's `int(t / FRAME)`. */
export const frameAt = (t: number): number => Math.trunc(t / F);
/** Python's `int(round(t / FRAME))`. */
export const frameNear = (t: number): number => pyRound(t / F);

/** `features.frame_rms` in dB (`search._env_db`): one value per `frame` s, a single one when shorter. */
export function envDb(x: Float32Array, frame: number = F): Float64Array {
  const w = Math.max(1, pyRound(frame * SR));
  const n = Math.floor(x.length / w);
  const sq = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) sq[i] = (x[i] ?? 0) * (x[i] ?? 0);
  if (n === 0) {
    const rms = Math.sqrt((x.length ? pairwiseSum(sq, 0, x.length) / x.length : Number.NaN) + 1e-20);
    return Float64Array.of(20 * Math.log10(Math.max(rms, 1e-12)));
  }
  const out = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const rms = Math.sqrt(pairwiseSum(sq, f * w, w) / w + 1e-20);
    out[f] = 20 * Math.log10(Math.max(rms, 1e-12));
  }
  return out;
}

/** env[a .. b) clipped to the array, as a NumPy slice reads it. */
function slice(env: Float64Array, a: number, b: number): Float64Array {
  return env.subarray(Math.max(0, Math.min(a, env.length)), Math.max(0, Math.min(b, env.length)));
}

/** `_tail_db`: the last 10 ms of [a, b) against the segment's peak. */
export function tailDb(env: Float64Array, a: number, b: number): number {
  const i = frameAt(a);
  const seg = slice(env, i, Math.max(i + 2, frameAt(b)));
  if (!seg.length) return 0;
  return maxOf(seg, Math.max(0, seg.length - 2)) - maxOf(seg);
}

/** `_head_db`: the first 5 ms of [a, b) against the segment's peak. */
export function headDb(env: Float64Array, a: number, b: number): number {
  const i = frameAt(a);
  const seg = slice(env, i, Math.max(i + 2, frameAt(b)));
  return seg.length ? (seg[0] ?? 0) - maxOf(seg) : 0;
}

/** Whether `mask` has a run of at least `n` true values (`np.convolve(mask, ones(n), 'valid').max() >= n`). */
function hasRun(mask: ArrayLike<boolean>, n: number): boolean {
  if (mask.length < n) return false;
  let run = 0;
  for (let i = 0; i < mask.length; i++) {
    run = mask[i] ? run + 1 : 0;
    if (run >= n) return true;
  }
  return false;
}

/** `_edit_gaps`: [a, b) holds ≥ 10 ms at or below −100 dBFS. */
export function editGaps(env: Float64Array, a: number, b: number): boolean {
  const seg = slice(env, frameAt(a), frameAt(b));
  return hasRun(
    Array.from(seg, (v) => v <= FIND.editDb),
    pyRound(FIND.editS / F),
  );
}

/** `_quiet_level`: 40 dB under the stretch's peak, or 6 dB over the floor if that is higher. */
export function quietLevel(env: Float64Array, floor: number, i0: number, i1: number): number {
  const seg = slice(env, i0, i1);
  return seg.length ? Math.max(floor + 6, maxOf(seg) - FIND.quietDb) : floor + 6;
}

/** `multi_sound`: [a, b) holds two separate sounds (a quiet stretch ≥ `gap` or an edit gap with sound both sides). */
export function multiSound(
  env: Float64Array,
  floor: number,
  a: number,
  b: number,
  gap = FIND.mergeGap,
): boolean {
  const i0 = frameNear(a);
  const i1 = frameNear(b);
  const seg = slice(env, i0, i1);
  if (seg.length < 3) return false;
  const q = quietLevel(env, floor, i0, i1);
  const loud: number[] = [];
  seg.forEach((v, i) => {
    if (v > q) loud.push(i);
  });
  const first = loud[0];
  const last = loud.at(-1);
  if (first === undefined || last === undefined || loud.length < 2) return false;
  if (editGaps(env, a + first * F, a + (last + 1) * F)) return true;
  const quiet = Array.from(seg.subarray(first, last + 1), (v) => v <= q);
  return hasRun(quiet, pyRound(gap / F));
}
