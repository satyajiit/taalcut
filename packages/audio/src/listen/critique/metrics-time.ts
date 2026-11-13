// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The timing measurements behind the critique (earshot profile.py and critique.py): the share of cuts with a target
 * (an onset, a salient hit, a beat) within a tolerance, what chance gives for the same cuts shifted off the picture,
 * and the AudioSet music and speech shares over 5 s windows.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { ListenFailed } from '../errors';
import type { AstTagger } from '../models/ast';
import { searchSorted } from '../dsp/stats';
import { LISTEN_SR } from '../dsp/pcm';

/** profile.SHIFTS: the fixed offsets (s) the chance value shifts the cuts by, circularly. */
export const CHANCE_SHIFTS = [
  0.23, 0.31, 0.43, 0.57, 0.71, 0.87, 1.13, 1.37, -0.29, -0.41, -0.53, -0.67, -0.79, -0.97, -1.19, -1.43,
] as const;

/** profile.near_frac: the share of `events` with a target within ±`tol` s; null without events. */
export function nearFrac(events: readonly number[], targets: readonly number[], tol: number): number | null {
  if (events.length === 0) return null;
  if (targets.length === 0) return 0;
  const sorted = [...targets].sort((a, b) => a - b);
  let hits = 0;
  for (const e of events) {
    const i = searchSorted(sorted, e);
    const a = sorted[Math.min(Math.max(i, 0), sorted.length - 1)] ?? 0;
    const b = sorted[Math.min(Math.max(i - 1, 0), sorted.length - 1)] ?? 0;
    if (Math.min(Math.abs(a - e), Math.abs(b - e)) <= tol) hits += 1;
  }
  return hits / events.length;
}

/** profile.chance_frac: the same share for the events shifted by each of CHANCE_SHIFTS (mod the duration). */
export function chanceFrac(
  events: readonly number[],
  targets: readonly number[],
  tol: number,
  dur: number,
): number | null {
  if (events.length === 0 || dur <= 0) return null;
  let sum = 0;
  for (const s of CHANCE_SHIFTS) {
    const shifted = events.map((e) => {
      const v = (e + s) % dur;
      // Python's % takes the divisor's sign.
      return v < 0 ? v + dur : v;
    });
    sum += nearFrac(shifted, targets, tol) ?? 0;
  }
  return sum / CHANCE_SHIFTS.length;
}

/** profile.AST_WIN and MUSIC_P: 5 s windows; music counts at p ≥ 0.3, speech at ≥ 0.5. */
export const MUSIC_WINDOW_S = 5.0;
export const MUSIC_P = 0.3;
export const SPEECH_P = 0.5;

/**
 * One AudioSet window: its start (s) and its 'Music' and 'Speech' probabilities, unrounded (the shares count them
 * as they are; the music-gap fix reads them at 2 decimals, as upstream's `music_windows` keeps them).
 */
export interface MusicWindow {
  readonly t: number;
  readonly music: number;
  readonly speech: number;
}

/** profile._ast_pass's windows: every 5 s from the start, the last only when it holds 1 s or more. */
export function musicWindowStarts(samples: number): number[] {
  const w = MUSIC_WINDOW_S * LISTEN_SR;
  const out: number[] = [];
  for (let s = 0; s < samples; s += w) if (samples - s >= LISTEN_SR || s === 0) out.push(s);
  return out;
}

/** The AudioSet pass of the critique on `mono` (earshot `audio.load(mono=True)`: ffmpeg's −ac 1 level). */
export async function musicWindows(
  ast: AstTagger,
  mono: Float32Array,
  signal?: AbortSignal,
): AsyncResult<MusicWindow[]> {
  const labels = await ast.labels(signal);
  if (!labels.ok) return labels;
  const music = labels.value.indexOf('Music');
  const speech = labels.value.indexOf('Speech');
  if (music < 0 || speech < 0)
    return err(ListenFailed(undefined, { detail: 'AST labels lack Music or Speech' }));
  const starts = musicWindowStarts(mono.length);
  const w = MUSIC_WINDOW_S * LISTEN_SR;
  const probs = await ast.probs(
    starts.map((s) => mono.subarray(s, s + w)),
    signal ? { signal } : {},
  );
  if (!probs.ok) return probs;
  return ok(
    probs.value.map((r, i) => ({
      t: Math.round(((starts[i] ?? 0) / LISTEN_SR) * 100) / 100,
      music: r.probs[music] ?? 0,
      speech: r.probs[speech] ?? 0,
    })),
  );
}

/** music_frac and speech_frac over the windows (unrounded probabilities, as upstream compares them). */
export function musicShares(windows: readonly MusicWindow[]): {
  music: number | null;
  speech: number | null;
} {
  if (windows.length === 0) return { music: null, speech: null };
  const n = windows.length;
  return {
    music: windows.filter((w) => w.music >= MUSIC_P).length / n,
    speech: windows.filter((w) => w.speech >= SPEECH_P).length / n,
  };
}
