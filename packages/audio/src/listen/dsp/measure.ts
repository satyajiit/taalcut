// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Objective measurements of a sound (earshot features.measure): levels (peak, true peak, RMS, BS.1770 integrated,
 * short-term maximum, LRA), clipped samples, DC, the noise floor (10th percentile of 20 ms RMS) and dynamic range,
 * digital-silence share, stereo width (side to mid, correlation), the envelope (attack, decay), the Welch spectrum's
 * shape and brightness; with `music`, earshot's own beat grid and the key. Not ported (librosa): HPSS harmonic
 * ratio, f0 and librosa's onset list (the timeline's events stand for onsets), and librosa's beat_track tempo
 * (the timeline's music grid stands for it). `toSoundMeasures` gives core's SoundMeasures.
 */
import { RationalTime, type SoundMeasures } from '@taalcut/core';
import { checkpoint } from '../abort';
import { estimateKey, type KeyCandidate } from './key';
import { integratedLufs, kPowerOf, loudnessCurve, loudnessRange, type KPower } from './loudness';
import { LISTEN_SR, db, monoOf, roundTo, stereoOf, toFloat64, type ListenAudio } from './pcm';
import type { SpectrogramRunner } from './spectrogram-graph';
import { brightnessHz, spectrumMeasures, welchPsd, type SpectrumMeasures } from './spectrum';
import { maximumFilter1d, pairwiseSum, percentile } from './stats';
import { musicGrid, type MusicGrid } from './tempo-grid';
import { truePeakDbtp } from './true-peak';

export interface EnvelopeTimes {
  readonly attackAt: number;
  readonly peakAt: number;
  readonly attackMs: number | null;
  readonly decayMs: number | null;
}

export interface Measurements extends Partial<SpectrumMeasures>, Partial<EnvelopeTimes> {
  readonly duration: number;
  readonly samples: number;
  readonly error?: 'too short to measure';
  readonly peakDbfs?: number;
  readonly truePeakDbtp?: number;
  readonly rmsDbfs?: number;
  readonly lufs?: number;
  readonly shortTermMaxLufs?: number;
  readonly lraLu?: number;
  readonly clippedSamples?: number;
  readonly dc?: number;
  readonly noiseFloorDbfs?: number;
  readonly dynamicRangeDb?: number;
  readonly digitalSilenceFrac?: number;
  readonly sideToMidDb?: number | null;
  readonly correlation?: number;
  readonly brightnessHz?: number | null;
  readonly grid?: MusicGrid;
  readonly key?: readonly KeyCandidate[];
}

/** features.smooth_env: an RMS envelope at 1 ms steps over a centred `winMs` window. */
function smoothEnv(m: Float64Array, winMs: number): Float64Array {
  const n = m.length;
  const w2 = Math.max(1, Math.trunc((winMs * LISTEN_SR) / 2000));
  const c = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) c[i + 1] = (c[i] ?? 0) + (m[i] ?? 0) ** 2;
  const out = new Float64Array(Math.ceil(n / 48));
  for (let k = 0; k < out.length; k++) {
    const mid = k * 48 + 24;
    const a = Math.min(Math.max(mid - w2, 0), n);
    const b = Math.min(Math.max(mid + w2, 0), n);
    out[k] = Math.sqrt(((c[b] ?? 0) - (c[a] ?? 0)) / Math.max(b - a, 1) + 1e-20);
  }
  return out;
}

/** features.envelope_times(m). */
export function envelopeTimes(m: Float64Array): EnvelopeTimes {
  const e5 = smoothEnv(m, 5);
  const e10 = smoothEnv(m, 10);
  let top5 = 0;
  for (const v of e5) top5 = Math.max(top5, v);
  const i0 = Math.max(
    0,
    e5.findIndex((v) => v >= top5 * 0.1),
  );
  const loc = e5.subarray(i0, i0 + 300);
  let ip = 0;
  for (let i = 1; i < e10.length; i++) if ((e10[i] ?? 0) > (e10[ip] ?? 0)) ip = i;
  const after = e10.subarray(ip);
  // maximum_filter1d(size=21, origin=-10, mode='nearest'): the max over [i, i + 20 ms].
  const ahead = maximumFilter1d(
    Float64Array.from(
      { length: after.length + 10 },
      (_, i) => after[Math.min(i + 10, after.length - 1)] ?? 0,
    ),
    21,
    'nearest',
  ).subarray(0, after.length);
  const thr = (e10[ip] ?? 0) * 10 ** (-30 / 20);
  const below = ahead.findIndex((v) => v < thr);
  let locMax = 0;
  for (const v of loc) locMax = Math.max(locMax, v);
  return {
    attackAt: roundTo(i0 / 1000, 3),
    peakAt: roundTo(ip / 1000, 3),
    attackMs:
      loc.length > 0
        ? Math.max(
            0,
            loc.findIndex((v) => v >= 0.9 * locMax),
          )
        : null,
    decayMs: below >= 0 ? below : null,
  };
}

export interface MeasureOptions {
  /** Also earshot's beat grid and the key (5 s or longer). */
  readonly music?: boolean;
  /** The K-weighted sums of the same audio, when the event pass already made them (EventAnalysis.kPower). */
  readonly kPower?: KPower;
  /** Its beat grid, when already made (the timeline's): not recomputed. */
  readonly grid?: MusicGrid;
  /** Stops between steps (abort.ts `checkpoint`: it unwinds; the analysis returns core.cancelled). */
  readonly signal?: AbortSignal;
}

/** features.measure(x, music) on 48 kHz audio. */
export async function measureSound(
  audio: ListenAudio,
  runner: SpectrogramRunner,
  options: MeasureOptions = {},
): Promise<Measurements> {
  const x = stereoOf(audio);
  const m32 = monoOf(x);
  const n = x.length;
  const base = { duration: roundTo(n / LISTEN_SR, 3), samples: n };
  if (n < Math.trunc(0.005 * LISTEN_SR)) return { ...base, error: 'too short to measure' };
  let pk = 0;
  let sq = 0;
  let clipped = 0;
  for (const c of [x.left, x.right]) {
    for (let i = 0; i < n; i++) {
      const a = Math.abs(c[i] ?? 0);
      pk = Math.max(pk, a);
      sq += a * a;
      if (a >= 0.999) clipped++;
    }
  }
  const { signal } = options;
  const k = options.kPower ?? kPowerOf(x);
  await checkpoint(signal);
  const out: Record<string, unknown> = {
    ...base,
    peakDbfs: roundTo(db(pk), 1),
    truePeakDbtp: roundTo(truePeakDbtp(x), 1),
    rmsDbfs: roundTo(db(Math.sqrt(sq / (2 * n))), 1),
  };
  await checkpoint(signal);
  if (n >= Math.trunc(0.4 * LISTEN_SR)) {
    out['lufs'] = roundTo(integratedLufs(k), 1);
    if (n >= 3 * LISTEN_SR) {
      let s = -Infinity;
      for (const v of loudnessCurve(k, 3.0, 0.5).lufs) s = Math.max(s, v);
      out['shortTermMaxLufs'] = roundTo(s, 1);
    }
    const lra = n >= 6 * LISTEN_SR ? loudnessRange(k) : null;
    if (lra !== null) out['lraLu'] = roundTo(lra, 1);
  }
  await checkpoint(signal);
  const m = toFloat64(m32);
  out['clippedSamples'] = clipped;
  out['dc'] = roundTo(pairwiseSum(m, 0, n) / n, 5);
  const frames = Math.floor(n / 960);
  const r20 =
    frames === 0
      ? [
          Math.sqrt(
            pairwiseSum(
              m.map((v) => v * v),
              0,
              n,
            ) /
              n +
              1e-20,
          ),
        ]
      : [];
  for (let f = 0; f < frames; f++) {
    const s = m.subarray(f * 960, (f + 1) * 960).map((v) => v * v);
    r20.push(Math.sqrt(pairwiseSum(s, 0, 960) / 960 + 1e-20));
  }
  const floor = roundTo(db(percentile(r20, 10)), 1);
  out['noiseFloorDbfs'] = floor;
  out['dynamicRangeDb'] = roundTo(db(Math.max(...r20)) - floor, 1);
  let zeros = 0;
  for (let i = 0; i < n; i++) if (Math.abs(m[i] ?? 0) < 1e-6) zeros++;
  out['digitalSilenceFrac'] = roundTo(zeros / n, 4);
  await checkpoint(signal);
  Object.assign(out, stereoWidth(x.left, x.right), envelopeTimes(m));
  await checkpoint(signal);
  const { f, p } = await welchPsd(m, runner);
  Object.assign(out, spectrumMeasures(f, p));
  out['brightnessHz'] = await brightnessHz(m32, runner);
  if (options.music && n >= 5 * LISTEN_SR) {
    out['grid'] = options.grid ?? (await musicGrid(m32, runner));
    out['key'] = await estimateKey(m32, runner);
  }
  return out as unknown as Measurements;
}

function stereoWidth(l: Float32Array, r: Float32Array): { sideToMidDb: number | null; correlation?: number } {
  const n = l.length;
  let side = 0;
  let mid = 0;
  for (let i = 0; i < n; i++) {
    const a = l[i] ?? 0;
    const b = r[i] ?? 0;
    side += Math.fround((a - b) / 2) ** 2;
    mid += Math.fround((a + b) / 2) ** 2;
  }
  const sm = Math.sqrt(side / n);
  const sideToMidDb = sm > 1e-7 ? roundTo(db(sm) - db(Math.sqrt(mid / n) + 1e-12), 1) : null;
  const stats = (c: Float32Array) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += c[i] ?? 0;
    const mu = s / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += ((c[i] ?? 0) - mu) ** 2;
    return { mu, sd: Math.sqrt(v / n) };
  };
  const a = stats(l);
  const b = l === r ? a : stats(r);
  if (!(a.sd > 1e-9 && b.sd > 1e-9)) return { sideToMidDb };
  let cov = 0;
  for (let i = 0; i < n; i++) cov += ((l[i] ?? 0) - a.mu) * ((r[i] ?? 0) - b.mu);
  return { sideToMidDb, correlation: roundTo(cov / n / (a.sd * b.sd), 3) };
}

const SAMPLE_RATE = { num: LISTEN_SR, den: 1 } as const;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Core's SoundMeasures. `nearSilent` is a sample peak under −70 dBFS; LUFS null when every block is gated out. */
export function toSoundMeasures(r: Measurements): SoundMeasures {
  const lufs = r.lufs !== undefined && r.lufs > -70 ? clamp(r.lufs, -120, 10) : null;
  const bands = r.bandsDb
    ? {
        sub: clamp(r.bandsDb.sub, -130, 0),
        low: clamp(r.bandsDb.low, -130, 0),
        lowmid: clamp(r.bandsDb.lowmid, -130, 0),
        mid: clamp(r.bandsDb.mid, -130, 0),
        presence: clamp(r.bandsDb.presence, -130, 0),
        air: clamp(r.bandsDb.air, -130, 0),
      }
    : null;
  const grid = r.grid;
  const key = r.key?.[0];
  return {
    duration: RationalTime.of(r.samples, SAMPLE_RATE),
    lufs,
    truePeakDbtp: clamp(r.truePeakDbtp ?? -240, -240, 40),
    peakDbfs: clamp(r.peakDbfs ?? -240, -240, 40),
    lraLu: r.lraLu !== undefined ? clamp(r.lraLu, 0, 100) : null,
    crestLu:
      r.shortTermMaxLufs !== undefined && lufs !== null ? clamp(r.shortTermMaxLufs - lufs, -60, 130) : null,
    noiseFloorDbfs: clamp(r.noiseFloorDbfs ?? -240, -240, 40),
    nearSilent: (r.peakDbfs ?? -240) < -70,
    bandwidthHz: r.bandwidthHz ?? null,
    brightnessHz: r.brightnessHz ?? null,
    bands,
    sideToMidDb: r.sideToMidDb ?? null,
    ...(grid
      ? {
          tempo:
            grid.tempo !== null && grid.confidence !== 'none'
              ? {
                  bpm: grid.tempo,
                  alt: grid.tempoAlt ?? null,
                  clarity: clamp(grid.pulseClarity ?? 0, -1, 1),
                  confidence: grid.confidence,
                }
              : null,
        }
      : {}),
    ...(r.key !== undefined
      ? { key: key ? { tonic: key.tonic, mode: key.mode, confidence: clamp(key.r, -1, 1) } : null }
      : {}),
  };
}
