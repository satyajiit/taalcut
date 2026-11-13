// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * earshot's own beat grid (timeline.music_grid): log-mel flux at 10 ms (graph), broadband and low band (the first 6
 * of 64 bands), local mean removed and standardised; the beat period from each envelope's autocorrelation over
 * 60–200 BPM with a soft log-Gaussian prior at 120 BPM (σ 0.9 octave), the envelope that pulses more clearly
 * winning; beats by Ellis's dynamic programming; a downbeat guess (downbeat.ts) and the pulse clarity (the
 * normalised autocorrelation at the period): clear from 0.30 with an interval CV under 0.1, weak from 0.15.
 *
 * Taalcut's Beat This! tracker stays the editor's beat map; this grid is what the listening reports and the
 * critique reads, with upstream's numbers.
 */
import { autocorrelation } from './fft';
import { downbeatPhase } from './downbeat';
import { LISTEN_SR, pyRound, roundTo } from './pcm';
import type { SpectrogramRunner } from './spectrogram-graph';
import { pulseSpec } from './spectra';
import { mean, std, uniformFilter1d } from './stats';
import { centredFrames } from './transforms';

export const CLEAR_PULSE = 0.3;
export const WEAK_PULSE = 0.15;
const MELS = 64;

export type PulseConfidence = 'clear' | 'weak' | 'none';

export interface MusicGrid {
  /** BPM (0.1); null without a grid. */
  readonly tempo: number | null;
  /** The double tempo when it pulses at least half as clearly. */
  readonly tempoAlt?: number | null;
  /** Seconds at 10 ms resolution. */
  readonly beats: readonly number[];
  readonly downbeats: readonly number[];
  readonly pulseClarity?: number;
  readonly beatRegularity?: number;
  readonly confidence: PulseConfidence;
  readonly note?: string;
}

export interface PeriodEstimate {
  /** Beat period in 10 ms frames (parabolic sub-frame). */
  readonly period: number;
  readonly clarity: number;
  readonly score: number;
  readonly ac: Float64Array;
}

/** timeline._pulse_envs from the pulse log-mel ([frames, 64] dB). */
export function pulseEnvelopes(logMel: Float32Array, frames: number): [Float64Array, Float64Array] {
  let top = -Infinity;
  for (let i = 0; i < logMel.length; i++) top = Math.max(top, logMel[i] ?? -Infinity);
  const floor = top - 80;
  const broad = new Float64Array(frames);
  const low = new Float64Array(frames);
  for (let t = 1; t < frames; t++) {
    let sumAll = 0;
    let sumLow = 0;
    for (let b = 0; b < MELS; b++) {
      const cur = Math.max(logMel[t * MELS + b] ?? floor, floor);
      const prev = Math.max(logMel[(t - 1) * MELS + b] ?? floor, floor);
      const d = Math.max(cur - prev, 0);
      sumAll += d;
      if (b < 6) sumLow += d;
    }
    broad[t] = sumAll / MELS;
    low[t] = sumLow / 6;
  }
  const standardise = (env: Float64Array) => {
    const local = uniformFilter1d(env, 101);
    const out = new Float64Array(env.length);
    for (let i = 0; i < env.length; i++) out[i] = Math.max((env[i] ?? 0) - (local[i] ?? 0), 0);
    const s = std(out) + 1e-9;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / s;
    return out;
  };
  return [standardise(broad), standardise(low)];
}

/** timeline._period: null when the envelope is too short for the lag range. */
export function beatPeriod(env: Float64Array, minBpm = 60, maxBpm = 200): PeriodEstimate | null {
  const m = mean(env);
  const e0 = env.map((v) => v - m);
  const ac = autocorrelation(e0);
  const a0 = (ac[0] ?? 0) + 1e-12;
  for (let i = 0; i < ac.length; i++) ac[i] = (ac[i] ?? 0) / a0;
  const first = Math.trunc(6000 / maxBpm);
  const last = Math.min(Math.trunc(6000 / minBpm), Math.floor(ac.length / 2));
  if (last <= first) return null;
  const sc = new Float64Array(last - first);
  for (let l = first; l < last; l++) {
    const prior = Math.exp(-0.5 * (Math.log2(6000 / l / 120) / 0.9) ** 2);
    sc[l - first] = ((ac[l] ?? 0) + 0.5 * (ac[Math.min(2 * l, ac.length - 1)] ?? 0)) * prior;
  }
  let k = 0;
  for (let i = 1; i < sc.length; i++) if ((sc[i] ?? 0) > (sc[k] ?? 0)) k = i;
  let period = first + k;
  if (k > 0 && k < sc.length - 1) {
    const y0 = sc[k - 1] ?? 0;
    const y1 = sc[k] ?? 0;
    const y2 = sc[k + 1] ?? 0;
    period += (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2 + 1e-12);
  }
  return { period, clarity: ac[pyRound(period)] ?? 0, score: sc[k] ?? 0, ac };
}

/** Ellis's DP over the onset envelope: beat frames, ascending. */
export function trackBeats(env: Float64Array, period: number): number[] {
  const lo = Math.max(1, Math.trunc(period / 2));
  const hi = Math.trunc(2 * period);
  const pen = new Float64Array(hi - lo + 1);
  for (let w = lo; w <= hi; w++) pen[w - lo] = 100 * Math.log(w / period) ** 2;
  const score = Float64Array.from(env);
  const back = new Int32Array(env.length).fill(-1);
  for (let t = Math.trunc(period / 2); t < env.length; t++) {
    let best = -Infinity;
    let from = -1;
    for (let w = lo; w <= hi; w++) {
      const p = t - w;
      if (p < 0) break;
      const c = (score[p] ?? 0) - (pen[w - lo] ?? 0);
      if (c > best) {
        best = c;
        from = p;
      }
    }
    if (from >= 0 && best > 0) {
      score[t] = (score[t] ?? 0) + best;
      back[t] = from;
    }
  }
  const tail = Math.trunc(period);
  let t = env.length - tail;
  let top = -Infinity;
  for (let i = env.length - tail; i < env.length; i++) {
    if ((score[i] ?? -Infinity) > top) {
      top = score[i] ?? -Infinity;
      t = i;
    }
  }
  const beats: number[] = [];
  while (t >= 0) {
    beats.push(t);
    t = back[t] ?? -1;
  }
  return beats.reverse();
}

/** timeline.music_grid(m) on a 48 kHz mono signal. */
export async function musicGrid(
  mono: ArrayLike<number>,
  runner: SpectrogramRunner,
  minBpm = 60,
  maxBpm = 200,
): Promise<MusicGrid> {
  const none = { tempo: null, beats: [], downbeats: [], confidence: 'none' as const };
  if (mono.length < 5 * LISTEN_SR) return { ...none, note: 'too short for a beat grid' };
  const mel = await runner.spectrogram(pulseSpec(), centredFrames(mono, 2048, 480));
  const envs = pulseEnvelopes(mel.data, mel.frames);
  let chosen: { p: PeriodEstimate; env: Float64Array } | undefined;
  for (const env of envs) {
    const p = beatPeriod(env, minBpm, maxBpm);
    if (p && (!chosen || p.score > chosen.p.score)) chosen = { p, env };
  }
  if (!chosen) return { ...none, note: 'too short for a beat grid' };
  const { p, env } = chosen;
  const beats = trackBeats(env, p.period);
  if (beats.length < 4) return { ...none, note: 'no steady pulse found' };
  const ibi = beats.slice(1).map((b, i) => b - (beats[i] ?? 0));
  const reg = std(ibi) / mean(ibi);
  const confidence: PulseConfidence =
    p.clarity >= CLEAR_PULSE && reg < 0.1 ? 'clear' : p.clarity >= WEAK_PULSE ? 'weak' : 'none';
  const phase = await downbeatPhase(mono, beats, runner);
  const bt = beats.map((b) => b * 0.01);
  const h = pyRound(p.period / 2);
  const alt =
    12000 / p.period <= maxBpm && (p.ac[h] ?? 0) >= 0.5 * p.clarity ? roundTo(12000 / p.period, 1) : null;
  return {
    tempo: roundTo(6000 / p.period, 1),
    tempoAlt: alt,
    beats: bt.map((b) => roundTo(b, 3)),
    downbeats: bt.filter((_, i) => i >= phase && (i - phase) % 4 === 0).map((b) => roundTo(b, 3)),
    pulseClarity: roundTo(p.clarity, 3),
    beatRegularity: roundTo(reg, 3),
    confidence,
  };
}
