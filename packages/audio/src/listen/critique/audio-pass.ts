// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * profile._audio_pass: the light measurements (features.measure without librosa's slow parts: F6's measureSound),
 * librosa's onset envelope and onsets on a 22.05 kHz copy (onsets.ts), each onset at its attack on the 2 ms level,
 * and three loudness curves: 100 ms blocks every 20 ms (the level), 400 ms every 100 ms (momentary) and 3 s every
 * 100 ms (short-term). librosa's `beat_track` (the tempo and `cutsOnBeat`, both info rows the score never reads) is
 * not ported: callers that want them pass beats (the timeline's grid or Beat This!) to `filmMetrics`.
 */
import { RationalTime, type SoundMeasures } from '@taalcut/core';
import { checkpoint } from '../abort';
import { kPowerOf, loudnessCurve, type KPower, type LoudnessCurve } from '../dsp/loudness';
import { measureSound, type Measurements } from '../dsp/measure';
import { LISTEN_SR, monoOf, stereoOf, type ListenAudio } from '../dsp/pcm';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import { pairwiseSum } from '../dsp/stats';
import { pyRoundTo } from '../realness/py-round';
import { resampleFrom48kAbortable } from '../realness/resample';
import { ATTACK_FRAME_S, attackTimes, onsetDetect, onsetStrength } from './onsets';

export interface AudioPass {
  readonly meas: Measurements;
  /** librosa's onset strength, 22.05 kHz / 256 frames. */
  readonly env: Float32Array;
  /** Onsets at their attacks, seconds. */
  readonly onsets: readonly number[];
  /** 20·log10 of the 2 ms RMS (+1e-9), float32. */
  readonly e2: Float32Array;
  /** 100 ms / 20 ms. */
  readonly level: LoudnessCurve;
  /** 400 ms / 100 ms. */
  readonly momentary: LoudnessCurve;
  /** 3 s / 100 ms. */
  readonly shortTerm: LoudnessCurve;
  readonly kPower: KPower;
  /** Where the onset spectrogram ran. */
  readonly backend: string;
}

/** 20·log10(features.frame_rms(m, 96) + 1e-9) as float32. */
export function levels2ms(mono: Float32Array): Float32Array {
  const win = Math.trunc(ATTACK_FRAME_S * LISTEN_SR);
  const n = Math.floor(mono.length / win);
  const sq = new Float64Array(mono.length);
  for (let i = 0; i < mono.length; i++) sq[i] = (mono[i] ?? 0) ** 2;
  if (n === 0) {
    const rms = Math.sqrt(pairwiseSum(sq, 0, sq.length) / Math.max(1, sq.length) + 1e-20);
    return Float32Array.of(20 * Math.log10(rms + 1e-9));
  }
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const rms = Math.sqrt(pairwiseSum(sq, f * win, win) / win + 1e-20);
    out[f] = 20 * Math.log10(rms + 1e-9);
  }
  return out;
}

export interface AudioPassOptions {
  /** The K-weighted sums, when the event pass already made them. */
  readonly kPower?: KPower;
  /** The light measurements, when an analysis already made them (measurementsOf its SoundMeasures). */
  readonly meas?: Measurements;
  /** Stops between steps (abort.ts `checkpoint`: it unwinds; the analysis returns core.cancelled). */
  readonly signal?: AbortSignal;
}

/**
 * What the critique reads of `features.measure`, from core's SoundMeasures of the same audio (F7's analysis): the
 * rounded loudness, true peak, LRA, crest (as its short-term maximum), bands, brightness and stereo width. The L/R
 * correlation isn't kept there; it only feeds an info row.
 */
export function measurementsOf(m: SoundMeasures): Measurements {
  const samples = Math.round(RationalTime.toSeconds(m.duration) * LISTEN_SR);
  return {
    duration: pyRoundTo(samples / LISTEN_SR, 3),
    samples,
    truePeakDbtp: m.truePeakDbtp,
    peakDbfs: m.peakDbfs,
    ...(m.lufs !== null ? { lufs: m.lufs } : {}),
    ...(m.lufs !== null && m.crestLu !== null ? { shortTermMaxLufs: m.lufs + m.crestLu } : {}),
    ...(m.lraLu !== null ? { lraLu: m.lraLu } : {}),
    sideToMidDb: m.sideToMidDb,
    brightnessHz: m.brightnessHz,
    ...(m.bands ? { bandsDb: { ...m.bands, top: -130 } } : {}),
  };
}

/** profile._audio_pass on decoded 48 kHz audio (`audio.load`: stereo, or mono duplicated). */
export async function audioPass(
  audio: ListenAudio,
  runner: SpectrogramRunner,
  options: AudioPassOptions = {},
): Promise<AudioPass> {
  const { signal } = options;
  const x = stereoOf(audio);
  const kPower = options.kPower ?? kPowerOf(x);
  await checkpoint(signal);
  const meas = options.meas ?? (await measureSound(audio, runner, { kPower, ...(signal ? { signal } : {}) }));
  const mono = monoOf(x);
  const env = await onsetStrength(await resampleFrom48kAbortable(mono, 22_050, signal), runner);
  await checkpoint(signal);
  const e2 = levels2ms(mono);
  return {
    meas,
    env,
    onsets: attackTimes(onsetDetect(env), e2),
    e2,
    level: loudnessCurve(kPower, 0.1, 0.02),
    momentary: loudnessCurve(kPower, 0.4, 0.1),
    shortTerm: loudnessCurve(kPower, 3.0, 0.1),
    kPower,
    backend: runner.backend() ?? 'cpu',
  };
}
