// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The ducking gain envelope (SPEC P3.5), pure over measurements. FFmpeg's sidechaincompress isn't used: a finite
 * ratio can't guarantee a loudness gap (research: audio-mixing.md). Each voiced window gets one gain (so the bed
 * doesn't pump under a phrase): g = min(0, L_voice − L_music − (marginLu + 1)), the lowest over the frames the
 * check will count, with L the short-term loudness of the dry voice and the un-ducked music, clamped at the
 * floor. Aiming with momentary loudness, as the SPEC first said, ducked about 10 LU deeper than the check needs
 * on the test bed, because a quiet syllable sets the minimum; momentary still aims phrases too short to count. The acceptance meter is 3 s short-term loudness, and a 100 ms frame counts once voice fills
 * 1.5 s of its window, so a counted window can reach 1.5 s outside the voice: the ducked gain therefore covers
 * 1.5 s on either side of each voiced window (a pre-duck and a post-hold), or un-ducked music in that reach
 * would fail the check however low the window's gain. The gain ramps in over `attackMs` before that, holds
 * 150 ms more and releases over `releaseMs`; outside, the music is at its bed gain (no boosting). Points are
 * linear in dB.
 */
import type { DuckingSettings, GainPoint } from '@taalcut/core';
import { MIX_CONFIG } from './config';
import { voicedFrames, voicedMsIn, type Window } from './voice-activity';

export interface EnvelopeInput {
  readonly voiceMomentary: readonly number[];
  readonly musicMomentary: readonly number[];
  /** Short-term (3 s) loudness of the dry voice and the un-ducked music: the check's own meter. */
  readonly voiceShortTerm: readonly number[];
  readonly musicShortTerm: readonly number[];
  readonly windows: readonly Window[];
  readonly settings: DuckingSettings;
  readonly durationMs: number;
  /** Extra lowering per window, in dB (≥ 0): the second plan's correction for windows that failed the check. */
  readonly extraDb?: readonly number[];
}

export interface Envelope {
  readonly points: readonly GainPoint[];
  /** Each voiced window's gain, in dB. */
  readonly windowGains: readonly number[];
}

/** The gain a window needs on one meter: the lowest voice − music − (margin + 1) over the given frames. */
function lowest(
  frames: readonly number[],
  voice: readonly number[],
  music: readonly number[],
  target: number,
): number | null {
  let gain: number | null = null;
  for (const k of frames) {
    const m = music[k] ?? MIX_CONFIG.envelope.silenceLufs;
    if (m <= MIX_CONFIG.envelope.silenceLufs + 1) continue;
    const g = (voice[k] ?? MIX_CONFIG.envelope.silenceLufs) - m - target;
    gain = gain === null ? g : Math.min(gain, g);
  }
  return gain;
}

/**
 * A window's gain, aimed with the meter the check uses: the 3 s frames that will be counted and reach into the
 * window. A phrase too short for any frame to count is aimed with momentary loudness over its voiced hops.
 */
export function windowGain(input: EnvelopeInput, index: number): number {
  const window = input.windows[index];
  if (!window) return 0;
  const hop = MIX_CONFIG.hopMs;
  const { windowMs, minVoicedMs } = MIX_CONFIG.check;
  const target = input.settings.marginLu + MIX_CONFIG.envelope.headroomLu;
  const counted: number[] = [];
  const voicedHops: number[] = [];
  const voiced = voicedFrames(input.voiceMomentary);
  for (let k = 0; k < input.voiceMomentary.length; k++) {
    const end = (k + 1) * hop;
    if (voiced[k] && end > window.startMs && end - hop < window.endMs) voicedHops.push(k);
    const reaches = end > window.startMs && end - windowMs < window.endMs;
    if (reaches && end >= windowMs && voicedMsIn(input.windows, end - windowMs, end) >= minVoicedMs)
      counted.push(k);
  }
  const aimed =
    lowest(counted, input.voiceShortTerm, input.musicShortTerm, target) ??
    lowest(voicedHops, input.voiceMomentary, input.musicMomentary, target) ??
    0;
  const lowered = aimed - (input.extraDb?.[index] ?? 0);
  return Math.max(input.settings.floorDb, Math.min(0, lowered));
}

/** How far a counted 3 s check window reaches outside the voice. */
export const CHECK_REACH_MS = MIX_CONFIG.check.windowMs - MIX_CONFIG.check.minVoicedMs;

/** One window's ramp at time t: 0 → g over the attack, g through the reach and the hold, back to 0 over the release. */
function rampAt(t: number, w: Window, g: number, settings: DuckingSettings): number {
  const duckStart = w.startMs - CHECK_REACH_MS;
  const attackStart = duckStart - settings.attackMs;
  const holdEnd = w.endMs + CHECK_REACH_MS + MIX_CONFIG.envelope.holdMs;
  const releaseEnd = holdEnd + settings.releaseMs;
  if (t <= attackStart || t >= releaseEnd) return 0;
  if (t < duckStart) return (g * (t - attackStart)) / settings.attackMs;
  if (t <= holdEnd) return g;
  return g * (1 - (t - holdEnd) / settings.releaseMs);
}

const toSample = (ms: number) => Math.round((ms * MIX_CONFIG.sampleRate) / 1000);

export function planEnvelope(input: EnvelopeInput): Envelope {
  const windowGains = input.windows.map((_, i) => windowGain(input, i));
  if (!input.settings.enabled || windowGains.every((g) => g === 0)) return { points: [], windowGains };
  const step = MIX_CONFIG.envelope.stepMs;
  const values: { ms: number; db: number }[] = [];
  for (let ms = 0; ms <= input.durationMs + step; ms += step) {
    const t = Math.min(ms, input.durationMs);
    let db = 0;
    input.windows.forEach((w, i) => (db = Math.min(db, rampAt(t, w, windowGains[i] ?? 0, input.settings))));
    values.push({ ms: t, db: Math.round(db * 100) / 100 });
    if (t === input.durationMs) break;
  }
  // Keep the first, the last and every point where the slope changes (beyond the 0.01 dB rounding).
  const points: GainPoint[] = [];
  values.forEach((v, i) => {
    const before = values[i - 1];
    const after = values[i + 1];
    const straight = before && after && Math.abs(v.db - before.db - (after.db - v.db)) < 0.011;
    if (!straight) points.push({ sample: toSample(v.ms), db: v.db });
  });
  return { points, windowGains };
}

/** The envelope's gain at a sample (linear in dB between points; 0 outside). */
export function gainAt(points: readonly GainPoint[], sample: number): number {
  if (points.length === 0) return 0;
  const first = points[0];
  if (!first || sample <= first.sample) return first?.db ?? 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) break;
    if (sample <= b.sample) {
      const span = b.sample - a.sample;
      return span <= 0 ? b.db : a.db + ((b.db - a.db) * (sample - a.sample)) / span;
    }
  }
  return points.at(-1)?.db ?? 0;
}
