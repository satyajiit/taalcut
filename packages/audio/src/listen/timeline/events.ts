// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The listening timeline's events (earshot timeline.detect_events): superflux onsets refined to their attack, merged
 * within 30 ms, a lead event when the file starts with sound, the prominence over the bed, swells timed at their
 * peak, and each event's peak, local loudness and excess centroid. Times are seconds from the start of the audio,
 * rounded as upstream rounds them; `toSoundEvents` turns them into core's `SoundEvent`s (RationalTime at 1 ms).
 */
import { RationalTime, type SoundEvent } from '@taalcut/core';
import { checkpoint } from '../abort';
import { BED_FLOOR, eventLengthMs, excessCentroidHz, refineAttack } from '../dsp/attack';
import {
  bandEnvelopes,
  highsOf,
  kWeightedEnvelopeDb,
  levelEnvelopes,
  type EnvelopeBand,
  type LevelEnvelopes,
} from '../dsp/envelopes';
import { kPowerOf, loudnessCurve, type KPower } from '../dsp/loudness';
import { LISTEN_SR, monoOf, roundTo, stereoOf, type ListenAudio, type Stereo } from '../dsp/pcm';
import { eventPeakDbfs, interp, prominenceAt } from '../dsp/prominence';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import { onsetCurve, onsetFrameTime, pickOnsets, robustZ, superfluxLogMel } from '../dsp/superflux';
import { argMax, maxOf } from '../dsp/stats';
import { detectSwells } from '../dsp/swells';

export interface ListenEvent {
  /** Seconds (a hit's attack at 1 ms, a swell's peak at 10 ms), rounded to 3 decimals. */
  readonly t: number;
  readonly shape: 'hit' | 'swell';
  readonly band: EnvelopeBand;
  readonly contrastDb: number;
  /** Onset novelty in robust SDs (0 for swells and the lead event). */
  readonly z: number;
  readonly lengthMs: number;
  readonly prominenceDb: number;
  readonly bedDb: number;
  readonly peakDbfs: number;
  readonly localLufs: number;
  readonly centroidHz: number | null;
  readonly riseMs?: number;
  /** The file's first sound (nothing precedes it). */
  readonly startsFile?: boolean;
  /** Against the nearest beat, when a beat grid was given (ms, 0.1). */
  readonly beatOffsetMs?: number;
}

export interface EventOptions {
  readonly zThreshold?: number;
  readonly minContrastDb?: number;
  readonly minGapS?: number;
  /** The audio starts where the file does, so sound from its first millisecond is an event. Default true. */
  readonly lead?: boolean;
  /** Stops between steps (abort.ts `checkpoint`: it unwinds; the analysis returns core.cancelled). */
  readonly signal?: AbortSignal;
}

/** What detection read, kept for sync (level peaks), the critique and the parity tests. */
export interface EventAnalysis {
  readonly events: ListenEvent[];
  readonly levels: LevelEnvelopes | null;
  readonly onset: { readonly odf: Float64Array; readonly z: Float64Array; readonly picked: number[] };
  readonly kPower: KPower;
  readonly backend: string;
}

interface Draft {
  t: number;
  shape: 'hit' | 'swell';
  band: EnvelopeBand;
  contrastDb: number;
  z: number;
  lengthMs: number;
  prominenceDb: number;
  bedDb: number;
  riseMs?: number;
  startsFile?: boolean;
}

function hitDrafts(
  x: Stereo,
  mono: Float32Array,
  highs: Float64Array,
  z: Float64Array,
  picked: number[],
  o: EventOptions,
) {
  const envs = bandEnvelopes(x, mono, highs);
  const out: Draft[] = [];
  for (const i of picked) {
    const att = refineAttack(envs, onsetFrameTime(i));
    if (!att || 20 * Math.log10(att.ratio) < (o.minContrastDb ?? 3.0)) continue;
    const { j, ip, bed, band: tband } = att.timing;
    out.push({
      t: j / 1000,
      shape: 'hit',
      band: att.band,
      contrastDb: Math.min(20 * Math.log10(att.ratio), 60),
      z: Math.min(z[i] ?? 0, 99),
      lengthMs: eventLengthMs(envs[tband], j, ip, bed),
      prominenceDb: 0,
      bedDb: 0,
    });
  }
  out.sort((a, b) => a.t - b.t);
  const merged: Draft[] = [];
  for (const e of out) {
    const last = merged[merged.length - 1];
    if (last && e.t - last.t < (o.minGapS ?? 0.03)) {
      if (e.contrastDb > last.contrastDb) merged[merged.length - 1] = e;
      continue;
    }
    merged.push(e);
  }
  const full = envs.full;
  const head = Math.min(50, full.length);
  if (
    (o.lead ?? true) &&
    full.length > 5 &&
    maxOf(full, 0, head) >= 1e-3 &&
    !merged.some((e) => e.t < 0.05)
  ) {
    const ip = argMax(full, 0, head);
    const limit = 0.1 * (full[ip] ?? 0);
    let j = 0;
    while (j <= ip && (full[j] ?? 0) < limit) j++;
    if (j > ip) j = 0;
    merged.unshift({
      t: j / 1000,
      shape: 'hit',
      band: 'full',
      contrastDb: 60,
      z: 0,
      lengthMs: eventLengthMs(full, j, ip, BED_FLOOR),
      prominenceDb: 0,
      bedDb: 0,
      startsFile: true,
    });
  }
  return merged;
}

/** timeline.detect_events(x) on the runner's spectrogram; empty under 0.1 s. */
export async function analyseEvents(
  audio: ListenAudio,
  runner: SpectrogramRunner,
  options: EventOptions = {},
): Promise<EventAnalysis> {
  const { signal } = options;
  const x = stereoOf(audio);
  const mono = monoOf(x);
  const kPower = kPowerOf(x);
  await checkpoint(signal);
  const highs = highsOf(mono);
  const levels = levelEnvelopes(mono, highs);
  const empty = { odf: new Float64Array(0), z: new Float64Array(0), picked: [] };
  if (mono.length < Math.trunc(0.1 * LISTEN_SR))
    return { events: [], levels, onset: empty, kPower, backend: 'cpu' };
  await checkpoint(signal);
  const mel = await superfluxLogMel(mono, runner);
  const odf = onsetCurve(mel);
  const z = robustZ(odf, 401);
  await checkpoint(signal);
  const picked = pickOnsets(odf, z, options.zThreshold ?? 3.0);
  const merged = hitDrafts(x, mono, highs, z, picked, options);
  await checkpoint(signal);
  const kw = kWeightedEnvelopeDb(kPower);
  for (const e of merged) {
    const p = prominenceAt(kw, e.t, e.startsFile === true);
    e.prominenceDb = p.prominenceDb;
    e.bedDb = p.bedDb;
  }
  const swells: Draft[] = detectSwells(
    levels,
    merged.map((e) => e.t),
  ).map((s) => ({
    t: s.t,
    shape: 'swell',
    band: s.band,
    contrastDb: s.riseDb,
    z: 0,
    lengthMs: s.lengthMs,
    prominenceDb: s.riseDb,
    bedDb: s.bedDb,
    riseMs: s.riseMs,
  }));
  const all = [...merged, ...swells].sort((a, b) => a.t - b.t);
  await checkpoint(signal);
  const lm =
    mono.length > 0.4 * LISTEN_SR
      ? loudnessCurve(kPower, 0.4, 0.05)
      : { t: Float64Array.of(0), lufs: Float64Array.of(-70) };
  const events = all.map((e): ListenEvent => ({
    t: roundTo(e.t, 3),
    shape: e.shape,
    band: e.band,
    contrastDb: roundTo(e.contrastDb, 1),
    z: roundTo(e.z, 1),
    lengthMs: e.lengthMs,
    prominenceDb: roundTo(e.prominenceDb, 1),
    bedDb: e.bedDb,
    peakDbfs: eventPeakDbfs(x, e.t, e.lengthMs),
    localLufs: roundTo(interp(e.t, lm.t, lm.lufs), 1),
    centroidHz: excessCentroidHz(mono, e.t, e.lengthMs / 1000),
    ...(e.riseMs !== undefined ? { riseMs: e.riseMs } : {}),
    ...(e.startsFile ? { startsFile: true } : {}),
  }));
  return { events, levels, onset: { odf, z, picked }, kPower, backend: mel.backend };
}

/** The events against the nearest beat (timeline: only with a clear or weak grid). */
export function withBeatOffsets(events: readonly ListenEvent[], beats: readonly number[]): ListenEvent[] {
  if (beats.length === 0) return [...events];
  return events.map((e) => {
    let best = 0;
    for (let k = 1; k < beats.length; k++) {
      if (Math.abs((beats[k] ?? 0) - e.t) < Math.abs((beats[best] ?? 0) - e.t)) best = k;
    }
    return { ...e, beatOffsetMs: roundTo((e.t - (beats[best] ?? 0)) * 1000, 1) };
  });
}

/** Events at or over this many dB above their bed dominate their excerpt (timeline.EXPOSED_DB). */
const EXPOSED_DB = 12;
const MS_RATE = { num: 1000, den: 1 } as const;
/** Core's bound on a beat offset: a beat over a minute away is no beat to be on or off (none is reported). */
export const BEAT_OFFSET_MAX_MS = 60_000;
export const withinBeatReach = (ms: number | undefined): ms is number =>
  ms !== undefined && Math.abs(ms) <= BEAT_OFFSET_MAX_MS;

/** Core's `SoundEvent`s (times at 1 ms, RationalTime); tags and AudioSet labels are F5's, added later. */
export function toSoundEvents(events: readonly ListenEvent[]): SoundEvent[] {
  return events.map((e) => ({
    at: RationalTime.fromSeconds(e.t, MS_RATE),
    shape: e.shape,
    band: e.band,
    contrastDb: Math.min(130, Math.max(0, e.contrastDb)),
    prominenceDb: Math.min(130, Math.max(0, e.prominenceDb)),
    bedDb: Math.min(20, Math.max(-130, e.bedDb)),
    peakDbfs: Math.min(40, Math.max(-240, e.peakDbfs)),
    lengthMs: e.lengthMs,
    ...(e.riseMs !== undefined ? { riseMs: e.riseMs } : {}),
    exposed: e.prominenceDb >= EXPOSED_DB,
    ...(withinBeatReach(e.beatOffsetMs) ? { beatOffsetMs: e.beatOffsetMs } : {}),
  }));
}
