// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bar-by-bar warp map from a generated track's tracked downbeats to the timeline's target downbeats (SPEC
 * P3.5 step 4). Pure. The generated downbeats are paired with the targets from the first target downbeat; the
 * pairing skips up to three leading generated downbeats (a pickup the tracker called a bar), choosing the shift
 * whose first eight bar ratios agree best (the SPEC's onset cross-correlation, done on the bars the tracker
 * already found). Each bar's ratio r = target bar / generated bar must lie in 0.85–1.15; boundaries are whole
 * output samples computed from absolute times, so the running error never exceeds half a sample.
 */
import { err, ok, type Result } from '@taalcut/core';
import type { StretchSegment } from '../stretch/stretcher';
import { MUSIC_CONFIG } from './config';
import { downbeatTimes, type BeatGrid } from './beat-grid';
import { WarpOutOfRange } from './errors';

export interface WarpPlan {
  readonly segments: readonly StretchSegment[];
  /** Silence before the music so its first paired downbeat lands on the target's. */
  readonly leadSamples: number;
  /** Generated downbeats skipped at the start. */
  readonly shift: number;
  readonly ratios: readonly number[];
  /** The median bar ratio: what a regeneration corrects the tempo by. */
  readonly medianRatio: number;
}

export interface WarpInput {
  readonly target: BeatGrid;
  readonly generated: BeatGrid;
  readonly sampleRate: number;
  /** The decoded generated track's length in samples. */
  readonly sourceFrames: number;
  /** Where the warped track should end on the timeline (its length plus the tail), in ms. */
  readonly endMs: number;
}

const toSample = (ms: number, rate: number) => Math.round((ms * rate) / 1000);

function barRatios(
  target: readonly number[],
  generated: readonly number[],
  shift: number,
  bars: number,
): number[] {
  const ratios: number[] = [];
  for (let i = 0; i + 1 < target.length && i + shift + 1 < generated.length && i < bars; i++) {
    const gen = (generated[i + shift + 1] ?? 0) - (generated[i + shift] ?? 0);
    const tgt = (target[i + 1] ?? 0) - (target[i] ?? 0);
    if (gen > 0) ratios.push(tgt / gen);
  }
  return ratios;
}

function choosePairing(target: readonly number[], generated: readonly number[]): number {
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  const maxShift = Math.min(MUSIC_CONFIG.pairing.maxShift, Math.max(0, generated.length - 2));
  for (let shift = 0; shift <= maxShift; shift++) {
    const ratios = barRatios(target, generated, shift, MUSIC_CONFIG.pairing.bars);
    if (ratios.length === 0) continue;
    const score = ratios.reduce((sum, r) => sum + Math.abs(Math.log(r)), 0) / ratios.length;
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = shift;
    }
  }
  return best;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
}

export function planWarp(input: WarpInput): Result<WarpPlan> {
  const rate = input.sampleRate;
  const target = downbeatTimes(input.target);
  const generated = downbeatTimes(input.generated);
  if (target.length < 2 || generated.length < 2)
    return err(WarpOutOfRange({ ratio: 0 }, { detail: 'fewer than two downbeats to pair' }));
  const shift = choosePairing(target, generated);
  const firstSource = toSample(generated[shift] ?? 0, rate);
  const firstTarget = toSample(target[0] ?? 0, rate);
  // Music before the first paired downbeat plays at its own speed and ends on the target's first downbeat.
  const pre = Math.min(firstSource, firstTarget);
  const segments: StretchSegment[] = [];
  if (pre > 0) segments.push({ sourceStart: firstSource - pre, sourceEnd: firstSource, targetLength: pre });
  const ratios: number[] = [];
  let source = firstSource;
  let out = firstTarget;
  const endSample = toSample(input.endMs, rate);
  for (let i = 0; i + 1 < target.length && i + shift + 1 < generated.length; i++) {
    const nextSource = Math.min(toSample(generated[i + shift + 1] ?? 0, rate), input.sourceFrames);
    const nextOut = toSample(target[i + 1] ?? 0, rate);
    if (nextSource <= source || nextOut <= out || out >= endSample) break;
    const ratio = (nextOut - out) / (nextSource - source);
    if (ratio < MUSIC_CONFIG.ratio.min || ratio > MUSIC_CONFIG.ratio.max)
      return err(WarpOutOfRange({ ratio: Number(ratio.toFixed(4)) }, { detail: `bar ${i}` }));
    ratios.push(ratio);
    segments.push({ sourceStart: source, sourceEnd: nextSource, targetLength: nextOut - out });
    source = nextSource;
    out = nextOut;
  }
  if (ratios.length === 0) return err(WarpOutOfRange({ ratio: 0 }, { detail: 'no bar could be paired' }));
  // After the last paired bar the music keeps the last bar's ratio until the timeline's end (or the music's).
  const last = ratios.at(-1) ?? 1;
  const remainingOut = Math.min(endSample - out, Math.floor((input.sourceFrames - source) * last));
  if (remainingOut > 0) {
    const tailSource = Math.min(input.sourceFrames, source + Math.max(1, Math.round(remainingOut / last)));
    segments.push({ sourceStart: source, sourceEnd: tailSource, targetLength: remainingOut });
  }
  return ok({
    segments,
    leadSamples: Math.max(0, firstTarget - pre),
    shift,
    ratios,
    medianRatio: median(ratios),
  });
}
