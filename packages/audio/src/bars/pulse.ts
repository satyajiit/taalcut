// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: the beat of a piece of music from its onset curve (spectrum.ts), with no model. The curve's
 * autocorrelation over 60 to 200 beats a minute gives a first beat length, as earshot's grid does
 * (listen/dsp/tempo-grid.ts, the same soft prior at 120). It is then measured again at 2, 4, 8, ... beats, each
 * time on the peak nearest the multiple: a lag of eight beats names the beat eight times as finely, which is what
 * lets a repeat of whole bars be stated to the millisecond. The beats' place in time is the comb of that length
 * that collects the most onset. Pure.
 */
import { autocorrelation } from '../listen/dsp/fft';
import { mean, std, uniformFilter1d } from '../listen/dsp/stats';
import { BARS_FRAME_SECONDS } from './spectrum';

/** The curve with its local mean (over 1 s) taken off, in units of its own spread. */
export function standardise(curve: Float64Array): Float64Array {
  const local = uniformFilter1d(curve, Math.round(1 / BARS_FRAME_SECONDS) + 1);
  const out = new Float64Array(curve.length);
  for (let i = 0; i < curve.length; i++) out[i] = Math.max((curve[i] ?? 0) - (local[i] ?? 0), 0);
  const spread = std(out) + 1e-9;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / spread;
  return out;
}

export interface Likeness {
  /** How like itself the curve is `lag` frames later: 1 the same, 0 unrelated. Each lag over its own overlap. */
  at(lag: number): number;
  /** The highest value within `reach` frames of `lag`, and the lag it is at, to a fraction of a frame. */
  peakNear(lag: number, reach: number): { readonly lag: number; readonly value: number };
  /** The longest lag that still has enough of the curve on both sides to be read. */
  readonly longest: number;
}

export function likeness(curve: Float64Array): Likeness {
  const n = curve.length;
  const m = mean(curve);
  const raw = autocorrelation(curve.map((value) => value - m));
  const zero = (raw[0] ?? 0) / Math.max(1, n) + 1e-12;
  const value = (lag: number) => (lag < 0 || lag >= n ? 0 : (raw[lag] ?? 0) / (n - lag) / zero);
  const at = (lag: number) => {
    const low = Math.floor(lag);
    const share = lag - low;
    return value(low) * (1 - share) + value(low + 1) * share;
  };
  return {
    at,
    // Under 40% of the curve on both sides, a peak is a few bars' chance.
    longest: Math.floor(n * 0.6),
    peakNear(lag, reach) {
      const from = Math.max(1, Math.round(lag - reach));
      const to = Math.min(n - 2, Math.round(lag + reach));
      let best = from;
      for (let l = from; l <= to; l++) if (value(l) > value(best)) best = l;
      const [y0, y1, y2] = [value(best - 1), value(best), value(best + 1)];
      const bend = y0 - 2 * y1 + y2;
      // The parabola through the three points; at the search's edge the peak is outside it.
      const shift = bend < 0 && best > from && best < to ? (0.5 * (y0 - y2)) / bend : 0;
      return { lag: best + Math.max(-0.5, Math.min(0.5, shift)), value: y1 };
    },
  };
}

export interface Beat {
  /** One beat, in 5 ms frames, to a fraction. */
  readonly frames: number;
  /** How like itself the curve is one beat later (0 to 1). */
  readonly clarity: number;
  /** The most beats the length was measured across. */
  readonly across: number;
}

const MIN_BPM = 60;
const MAX_BPM = 200;

/**
 * How far from a multiple of the beat its peak is looked for, in frames: a tenth of a beat. Each doubling at most
 * doubles the error of the length so far (under a frame), so the peak is well inside; a wider search could take
 * the off-beat's peak instead.
 */
export const multipleReach = (beat: number): number => Math.max(2, 0.1 * beat);

/** One beat's length; null when the curve is too short to hold four of the slowest beats. */
export function beatLength(like: Likeness): Beat | null {
  const first = Math.round(60 / MAX_BPM / BARS_FRAME_SECONDS);
  const last = Math.min(Math.round(60 / MIN_BPM / BARS_FRAME_SECONDS), Math.floor(like.longest / 2));
  if (last <= first) return null;
  let best = first;
  let top = -Infinity;
  for (let lag = first; lag <= last; lag++) {
    const bpm = 60 / (lag * BARS_FRAME_SECONDS);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = (like.at(lag) + 0.5 * like.at(2 * lag)) * prior;
    if (score > top) [top, best] = [score, lag];
  }
  let frames = like.peakNear(best, 2).lag;
  const clarity = like.at(frames);
  let across = 1;
  // The same beat measured across more of them: the peak nearest each multiple, while it is still a clear one.
  for (let beats = 2; beats * frames <= like.longest; beats *= 2) {
    const peak = like.peakNear(beats * frames, multipleReach(frames));
    if (peak.value < 0.5 * clarity) break;
    frames = peak.lag / beats;
    across = beats;
  }
  return { frames, clarity, across };
}

/** The curve at a fractional frame, the largest of the frames within `reach` of it. */
export function near(curve: Float64Array, frame: number, reach: number): number {
  let top = 0;
  for (let i = Math.round(frame - reach); i <= Math.round(frame + reach); i++)
    if ((curve[i] ?? 0) > top) top = curve[i] ?? 0;
  return top;
}

/** Where the first beat is, in frames from the start (under one beat): the comb that collects the most onset. */
export function beatOffset(curve: Float64Array, beat: number): number {
  let best = 0;
  let top = -Infinity;
  for (let offset = 0; offset < beat; offset++) {
    let sum = 0;
    for (let at = offset; at < curve.length; at += beat) sum += near(curve, at, 1);
    if (sum > top) [top, best] = [sum, offset];
  }
  return best;
}

/** The beats' frames: `offset`, then one every `beat` frames to the curve's end. */
export function beatFrames(curve: Float64Array, beat: number, offset: number): number[] {
  const out: number[] = [];
  for (let at = offset; at < curve.length - 1; at += beat) out.push(at);
  return out;
}

/** A rise counts as an onset when it stands a spread above the curve's mean. */
export const onsetThreshold = (curve: Float64Array): number => mean(curve) + std(curve);

/** The share of beats with an onset within 25 ms. */
export function beatsWithOnset(curve: Float64Array, beats: readonly number[]): number {
  if (beats.length === 0) return 0;
  const threshold = onsetThreshold(curve);
  return beats.filter((at) => near(curve, at, 5) >= threshold).length / beats.length;
}

/**
 * The curve's peak leads the attack it rises for by 1 to 3 ms (measured on clicks, kicks and soft notes placed at
 * known samples): a frame is centred on its time, and the rise shows once the attack is inside the window.
 */
const ATTACK_AFTER_PEAK_SECONDS = 0.0025;

/**
 * When the beat at `frame` sounds, in seconds: the attack of the onset within 15 ms of it, to a fraction of a
 * frame, or the beat's own place on the comb when no onset is there.
 */
export function beatSeconds(curve: Float64Array, frame: number): number {
  const from = Math.max(1, Math.round(frame) - 3);
  const to = Math.min(curve.length - 2, Math.round(frame) + 3);
  let best = from;
  for (let i = from; i <= to; i++) if ((curve[i] ?? 0) > (curve[best] ?? 0)) best = i;
  if (to < from || (curve[best] ?? 0) < onsetThreshold(curve))
    return Math.max(0, frame * BARS_FRAME_SECONDS + ATTACK_AFTER_PEAK_SECONDS);
  const [y0, y1, y2] = [curve[best - 1] ?? 0, curve[best] ?? 0, curve[best + 1] ?? 0];
  const bend = y0 - 2 * y1 + y2;
  const shift = bend < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / bend)) : 0;
  return Math.max(0, (best + shift) * BARS_FRAME_SECONDS + ATTACK_AFTER_PEAK_SECONDS);
}
