// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `find`'s onset-based candidates (search.py `event_candidates` at ff41f07) and the onsets they start from
 * (`features.onsets`: librosa's `onset_detect` with `backtrack=True` on a 22.05 kHz copy, hop 256, delta 0.07).
 *
 * - **stroke:** one onset until it has decayed by 35 dB (never into the next onset), its start on the attack's first
 *   1 ms frame minus 5 ms.
 * - **event:** strokes that belong together: pairs under 0.25 s apart (never led by a stroke 15 dB weaker) and longer
 *   chains, at most 2 s, never across an edit gap.
 * - **priority:** prominence over the floor, +10 when isolated (quiet before, decayed by 25 dB at the end).
 *
 * The onset envelope and peak picker are the critique's port of librosa (critique/onsets.ts, lane A); backtracking
 * moves each pick to the nearest earlier local minimum of the normalised envelope (`onset_backtrack`).
 */
import { roundTo } from '../calibrate/verdict';
import { onsetStrength, peakPick, ONSET_HOP, ONSET_SR } from '../critique/onsets';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import { argMax, maxOf, mean } from '../dsp/stats';
import { resampleFrom48k } from '../realness/resample';
import { editGaps, FIND, frameAt, tailDb } from './envelope';
import type { Candidate } from './windows';

const F = FIND.frame;
/** float32's smallest normal value (librosa util.tiny). */
const TINY_F32 = 1.1754943508222875e-38;

/** `onset_backtrack(events, energy)`: each frame to the last local minimum at or before it (0 when none). */
export function backtrack(frames: readonly number[], energy: ArrayLike<number>): number[] {
  const minima = [0];
  for (let i = 1; i + 1 < energy.length; i++) {
    const e = energy[i] ?? 0;
    if (e <= (energy[i - 1] ?? 0) && e < (energy[i + 1] ?? 0)) minima.push(i);
  }
  return frames.map((f) => {
    let best = 0;
    for (const m of minima) {
      if (m > f) break;
      best = m;
    }
    return best;
  });
}

/** `features.onsets(m)`: onset times in s (3 decimals) of 48 kHz mono, backtracked to where each sound begins. */
export async function librosaOnsets(x: Float32Array, runner: SpectrogramRunner): Promise<number[]> {
  const y = resampleFrom48k(x, ONSET_SR);
  if (y.length === 0) return [];
  const env = await onsetStrength(y, runner);
  if (env.length === 0) return [];
  let lo = Infinity;
  for (const v of env) lo = Math.min(lo, v);
  const norm = env.map((v) => v - lo);
  let hi = -Infinity;
  for (const v of norm) hi = Math.max(hi, v);
  const scale = Math.fround(hi + TINY_F32);
  for (let i = 0; i < norm.length; i++) norm[i] = (norm[i] ?? 0) / scale;
  if (!norm.some((v) => v !== 0) || norm.some((v) => !Number.isFinite(v))) return [];
  const rate = ONSET_SR / ONSET_HOP;
  const picked = peakPick(norm, {
    preMax: Math.floor(0.03 * rate),
    postMax: 1,
    preAvg: Math.floor(0.1 * rate),
    postAvg: Math.floor(0.1 * rate) + 1,
    delta: 0.07,
    wait: Math.floor(0.03 * rate),
  });
  return backtrack(picked, norm).map((f) => roundTo((f * ONSET_HOP) / ONSET_SR, 3));
}

/** `_refine_start`: the attack's first 1 ms frame near onset `t`, so a trim never clips it. */
export function refineStart(env1: Float64Array, t: number, floor: number): number {
  const ms = Math.trunc(t * 1000);
  const i0 = Math.max(0, ms - 30);
  const i1 = Math.min(env1.length, ms + 30);
  if (i1 <= i0) return t;
  const level = Math.max(floor + 10, maxOf(env1, i0, i1) - 30);
  for (let k = i0; k < i1; k++) if ((env1[k] ?? -Infinity) >= level) return k / 1000;
  return i0 / 1000;
}

interface Stroke {
  readonly start: number;
  readonly end: number;
  readonly prominence: number;
}

function strokesOf(
  env: Float64Array,
  env1: Float64Array,
  floor: number,
  onsets: readonly number[],
  dur: number,
) {
  const strokes: Stroke[] = [];
  onsets.forEach((o, i) => {
    const next = onsets[i + 1];
    const nxt = next ?? dur;
    const f0 = frameAt(o);
    const f1 = Math.min(env.length, Math.max(f0 + 1, frameAt(nxt)));
    if (f0 >= f1) return;
    const pk = argMax(env, f0, Math.min(f1, f0 + Math.trunc(0.06 / F) + 1));
    const level = Math.max((env[pk] ?? 0) - FIND.decayDb, floor + 4);
    let below = -1;
    for (let k = pk; k < f1; k++)
      if ((env[k] ?? 0) < level) {
        below = k;
        break;
      }
    let end = below >= 0 ? below * F + 0.02 : nxt;
    let st = Math.max(0, refineStart(env1, o, floor) - FIND.preRoll);
    const prev = strokes.at(-1);
    if (prev) st = Math.max(st, prev.end);
    end = Math.min(end, next !== undefined ? next - 0.002 : dur, st + FIND.capS);
    if (end - st >= 0.02) strokes.push({ start: st, end, prominence: (env[pk] ?? 0) - floor });
  });
  return strokes;
}

/** `event_candidates(x, n=None)`: every stroke and event, with its priority. */
export function eventCandidates(
  env: Float64Array,
  env1: Float64Array,
  floor: number,
  onsets: readonly number[],
  dur: number,
): Candidate[] {
  if (onsets.length === 0) return [];
  const strokes = strokesOf(env, env1, floor, onsets, dur);
  const out: Array<{ start: number; end: number; kind: Candidate['kind']; p: number }> = strokes.map((s) => ({
    start: s.start,
    end: s.end,
    kind: 'stroke',
    p: s.prominence,
  }));
  const joins = strokes.slice(1).map((b, k) => {
    const a = strokes[k] as Stroke;
    return b.start - a.end < FIND.mergeGap && !editGaps(env, a.start, b.start);
  });
  strokes.slice(1).forEach((b, k) => {
    const a = strokes[k] as Stroke;
    if (joins[k] && b.end - a.start <= FIND.capS && a.prominence >= b.prominence - FIND.weakDb)
      out.push({ start: a.start, end: b.end, kind: 'event', p: Math.max(a.prominence, b.prominence) });
  });
  let i = 0;
  while (i < strokes.length) {
    let j = i;
    const head = strokes[i] as Stroke;
    while (j + 1 < strokes.length && joins[j] && (strokes[j + 1] as Stroke).end - head.start <= FIND.capS)
      j += 1;
    let chain = strokes.slice(i, j + 1);
    const top = Math.max(...chain.map((s) => s.prominence));
    while (chain.length && (chain[0] as Stroke).prominence < top - FIND.weakDb) chain = chain.slice(1);
    if (chain.length > 2)
      out.push({
        start: (chain[0] as Stroke).start,
        end: (chain.at(-1) as Stroke).end,
        kind: 'event',
        p: top,
      });
    i = j + 1;
  }
  return out.map((c) => {
    const f = frameAt(c.start);
    const from = Math.max(0, f - 6);
    const to = Math.min(f, env.length);
    const quietBefore = to <= from || mean(env, from, to) <= floor + 10;
    const isolated = quietBefore && tailDb(env, c.start, c.end) <= -25;
    return { start: c.start, end: c.end, kind: c.kind, priority: c.p + (isolated ? 10 : 0) };
  });
}
