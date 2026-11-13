// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Peak frames to a BeatMap at 1000/1. Tempo from the onset autocorrelation
 * must agree with 60/median up to an octave, or the map is flagged. The
 * tempo shown is the map's span (BRK1): a line through every beat, since the
 * tracker's 50 frames a second round each interval by up to 20 ms. Downbeats
 * fall on whole bars: the bar length and phase most of the model's downbeats
 * agree on, every bar from the first.
 */
import { beatMapSchema, type BeatMap } from '@taalcut/core';
import { AUDIO_CONFIG } from '../config';
import { BEAT_FPS, MILLISECONDS, msTime } from '../rates';
import type { BeatAnalysis, BeatFlag } from './types';

const FPS = AUDIO_CONFIG.beats.fps;
const MS_PER_FRAME = 1000 / FPS;
const MAX_BEATS = 4000;
const MAX_DOWNBEATS = 1000;

export interface AssembleInput {
  readonly beatFrames: readonly number[];
  readonly downbeatFrames: readonly number[];
  readonly onset: Float32Array;
  readonly shiftMs: number;
}

interface BeatPoint {
  readonly frame: number;
  readonly ms: number;
}

export function assembleBeatAnalysis(input: AssembleInput): BeatAnalysis {
  const points = beatPoints(input.beatFrames, input.shiftMs).slice(0, MAX_BEATS);
  const modelIndexes = nearestIndexes(
    input.downbeatFrames,
    points.map((point) => point.frame),
  );
  const few = modelIndexes.length * AUDIO_CONFIG.beats.beatsPerDownbeat < points.length;
  const bars = few
    ? { indexes: inferredIndexes(points, input.onset), size: AUDIO_CONFIG.beats.beatsPerBar }
    : wholeBars(modelIndexes, points.length);
  const indexes = bars.indexes.slice(0, MAX_DOWNBEATS);
  const intervals = gaps(points);
  const medianMs = intervals.length > 0 ? median(intervals) : 0;
  const spread = intervalSpread(intervals, medianMs);
  const bpm = displayBpm(points, medianMs, spread);
  const confidence = onsetConfidence(points, input.onset);
  const flags = flagsFor(points.length, confidence, medianMs, input.onset, few);
  const beatMap: BeatMap = beatMapSchema.parse({
    rate: MILLISECONDS,
    beats: points.map((point) => msTime(point.ms)),
    downbeats: indexes,
    bpm,
    beatsPerBar: indexes.length >= 2 ? bars.size : null,
    confidence,
    source: 'tracker',
  });
  return {
    beatMap,
    downbeatSource: few ? 'inferred' : 'model',
    flags,
    envelope: { rate: BEAT_FPS, peaks: Array.from(input.onset) },
    model: AUDIO_CONFIG.beats.model,
  };
}

export function emptyBeatAnalysis(): BeatAnalysis {
  return assembleBeatAnalysis({
    beatFrames: [],
    downbeatFrames: [],
    onset: new Float32Array(0),
    shiftMs: 0,
  });
}

function beatPoints(frames: readonly number[], shiftMs: number): BeatPoint[] {
  const points: BeatPoint[] = [];
  const ordered = frames.slice().sort((a, b) => a - b);
  for (const frame of ordered) {
    const ms = Math.max(0, Math.round(frame * MS_PER_FRAME) + shiftMs);
    const prev = points[points.length - 1];
    if (prev && prev.ms === ms) continue;
    points.push({ frame, ms });
  }
  return points;
}

function nearestIndexes(targets: readonly number[], frames: readonly number[]): number[] {
  if (frames.length === 0) return [];
  const indexes: number[] = [];
  for (const target of targets) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const dist = Math.abs((frames[i] ?? 0) - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    indexes.push(best);
  }
  return uniqueSorted(indexes);
}

function inferredIndexes(points: readonly BeatPoint[], onset: Float32Array): number[] {
  if (points.length === 0) return [];
  const score = [0, 0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const bin = Math.round(points[i]?.frame ?? 0);
    score[i % 4] = (score[i % 4] ?? 0) + (onset[bin] ?? 0);
  }
  let phase = 0;
  for (let i = 1; i < 4; i++) if ((score[i] ?? 0) > (score[phase] ?? 0)) phase = i;
  const indexes: number[] = [];
  for (let i = phase; i < points.length; i += AUDIO_CONFIG.beats.beatsPerBar) indexes.push(i);
  return indexes;
}

function gaps(points: readonly BeatPoint[]): number[] {
  const intervals: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const delta = (points[i]?.ms ?? 0) - (points[i - 1]?.ms ?? 0);
    if (delta > 0) intervals.push(delta);
  }
  return intervals;
}

function median(values: readonly number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** An interval the tracker made by skipping beats is judged per beat it spans. */
function perBeat(interval: number, medianMs: number): number {
  return interval / Math.max(1, Math.round(interval / medianMs));
}

function intervalSpread(intervals: readonly number[], medianMs: number): number {
  if (intervals.length === 0 || medianMs <= 0) return 0;
  let min = Infinity;
  let max = 0;
  for (const interval of intervals) {
    const beat = perBeat(interval, medianMs);
    if (beat < min) min = beat;
    if (beat > max) max = beat;
  }
  return (max - min) / medianMs;
}

/**
 * The tempo from the map's span: the least-squares slope of beat time against beat number, each beat numbered by
 * how many median beats it sits from the first, so a skipped beat doesn't shorten the bar. Null for rubato.
 */
function displayBpm(points: readonly BeatPoint[], medianMs: number, spread: number): number | null {
  if (points.length < 2 || medianMs <= 0 || spread > AUDIO_CONFIG.beats.intervalSpread) return null;
  const first = points[0]!.ms;
  const numbers = points.map((point) => Math.round((point.ms - first) / medianMs));
  const meanX = numbers.reduce((sum, x) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.ms, 0) / points.length;
  let sxy = 0;
  let sxx = 0;
  points.forEach((point, i) => {
    sxy += (numbers[i]! - meanX) * (point.ms - meanY);
    sxx += (numbers[i]! - meanX) ** 2;
  });
  const bpm = 60_000 / (sxx > 0 ? sxy / sxx : medianMs);
  if (!(bpm > 0) || bpm > 400) return null;
  return bpm;
}

/** Bar lengths the model's downbeats may show: four unless three is clearly better. */
const BAR_SIZES = [4, 3] as const;
/** How much more of the model's downbeats three-beat bars must explain to be chosen over four. */
const THREE_MARGIN = 0.15;

/**
 * Downbeats on whole bars (BRK1): for each bar length, the phase most of the model's downbeats fall on and the share
 * of them it explains; four beats unless three explains clearly more. Then every bar from that phase to the end.
 */
function wholeBars(model: readonly number[], count: number): { indexes: number[]; size: number } {
  const fits = BAR_SIZES.map((size) => {
    const votes = Array.from({ length: size }, () => 0);
    for (const index of model) votes[index % size]! += 1;
    let phase = 0;
    for (let i = 1; i < size; i++) if (votes[i]! > votes[phase]!) phase = i;
    return { size, phase, share: model.length > 0 ? votes[phase]! / model.length : 0 };
  });
  const [four, three] = fits as [(typeof fits)[number], (typeof fits)[number]];
  const best = three.share >= four.share + THREE_MARGIN ? three : four;
  const indexes: number[] = [];
  for (let i = best.phase; i < count; i += best.size) indexes.push(i);
  return { indexes, size: best.size };
}

function onsetPeakMs(onset: Float32Array): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < onset.length - 1; i++) {
    const value = onset[i] ?? 0;
    if (value > 0 && value >= (onset[i - 1] ?? 0) && value > (onset[i + 1] ?? 0)) {
      peaks.push(i * MS_PER_FRAME);
    }
  }
  return peaks;
}

function onsetConfidence(points: readonly BeatPoint[], onset: Float32Array): number {
  if (points.length === 0) return 0;
  const peaks = onsetPeakMs(onset);
  let hits = 0;
  for (const point of points) {
    const at = Math.round(point.frame * MS_PER_FRAME);
    if (peaks.some((peak) => Math.abs(peak - at) <= AUDIO_CONFIG.beats.onsetMatchMs)) hits += 1;
  }
  return hits / points.length;
}

function onsetTempo(onset: Float32Array): number | null {
  const minLag = Math.round((FPS * 60) / 240);
  const maxLag = Math.round((FPS * 60) / 40);
  if (onset.length <= maxLag) return null;
  let mean = 0;
  for (let i = 0; i < onset.length; i++) mean += onset[i] ?? 0;
  mean /= onset.length;
  let bestLag = 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < onset.length; i++) {
      acc += ((onset[i] ?? 0) - mean) * ((onset[i + lag] ?? 0) - mean);
    }
    if (acc > best) {
      best = acc;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || best <= 0) return null;
  return (60 * FPS) / bestLag;
}

function tempoAgrees(beatBpm: number, other: number): boolean {
  for (const scale of [1, 2, 0.5]) {
    if (Math.abs(beatBpm - other * scale) / beatBpm <= 0.08) return true;
  }
  return false;
}

function flagsFor(
  count: number,
  confidence: number,
  medianMs: number,
  onset: Float32Array,
  few: boolean,
): BeatFlag[] {
  const flags: BeatFlag[] = [];
  if (count > 0 && confidence < AUDIO_CONFIG.beats.lowConfidence) flags.push('low_confidence');
  const beatBpm = count >= 2 && medianMs > 0 ? 60_000 / medianMs : 0;
  const other = beatBpm > 0 ? onsetTempo(onset) : null;
  if (beatBpm > 0 && other !== null && !tempoAgrees(beatBpm, other)) flags.push('tempo_disagrees');
  if (few) flags.push('few_downbeats');
  return flags;
}

function uniqueSorted(values: readonly number[]): number[] {
  const sorted = values.slice().sort((a, b) => a - b);
  const unique: number[] = [];
  for (const value of sorted) {
    if (unique[unique.length - 1] !== value) unique.push(value);
  }
  return unique;
}
