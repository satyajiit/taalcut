// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * earshot compare.feats (EAR1-A3): the comparable, trim-proof measurements of one sound that compare.ts's
 * `differences` turns into words: the active loudness (integrated, the sound padded to 0.4 s), the peak,
 * brightness, bandwidth, attack and decay, the sounding length (first to last 10 ms frame within 40 dB of the
 * loudest), the noise floor (sounds of 1 s or more), the stereo width (mono read as −40 dB) and the low end (the
 * sub and low bands' energy). From F6's light measurements (`measureSound`) of the same 48 kHz audio.
 */
import { integratedLufs, kPowerOf } from '../dsp/loudness';
import type { Measurements } from '../dsp/measure';
import { LISTEN_SR, monoOf, stereoOf, type ListenAudio } from '../dsp/pcm';
import { pyRoundTo } from '../realness/py-round';
import type { CompareFeatures } from './compare';

const MONO_DB = -40;

/** compare.active_lufs: integrated loudness of the sound padded with silence to at least 0.4 s. */
export function activeLufs(audio: ListenAudio): number {
  const x = stereoOf(audio);
  const n = Math.trunc(0.4 * LISTEN_SR);
  if (x.length >= n) return pyRoundTo(integratedLufs(kPowerOf(x)), 1);
  const pad = (c: Float32Array) => {
    const out = new Float32Array(n);
    out.set(c);
    return out;
  };
  const left = pad(x.left);
  const right = x.right === x.left ? left : pad(x.right);
  return pyRoundTo(integratedLufs(kPowerOf({ left, right, length: n })), 1);
}

/** compare.active_length: seconds from the first to the last 10 ms frame within `floorDb` of the loudest. */
export function activeLength(audio: ListenAudio, floorDb = 40): number {
  const x = stereoOf(audio);
  const m = monoOf(x);
  const win = Math.trunc(0.01 * LISTEN_SR);
  const frames = Math.floor(m.length / win);
  const rms: number[] = [];
  if (frames === 0) {
    let s = 0;
    for (const v of m) s += v * v;
    rms.push(Math.sqrt(s / Math.max(1, m.length) + 1e-20));
  }
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * win; i < (f + 1) * win; i++) s += (m[i] ?? 0) ** 2;
    rms.push(Math.sqrt(s / win + 1e-20));
  }
  const top = 20 * Math.log10(Math.max(...rms));
  const on = rms.flatMap((v, i) => (20 * Math.log10(v) >= top - floorDb ? [i] : []));
  const first = on[0] ?? 0;
  const last = on[on.length - 1] ?? 0;
  return pyRoundTo(Math.min(x.length / LISTEN_SR, (last - first + 1) * 0.01), 3);
}

/** compare.feats(measure(x, light=True), x). */
export function compareFeatures(m: Measurements, audio: ListenAudio): CompareFeatures {
  const out: CompareFeatures = { loudness_lufs: activeLufs(audio), length_s: activeLength(audio) };
  if (m.peakDbfs !== undefined) out.peak_dbfs = m.peakDbfs;
  if (m.brightnessHz !== undefined && m.brightnessHz !== null) out.brightness_hz = m.brightnessHz;
  if (m.bandwidthHz !== undefined && m.bandwidthHz !== null) out.bandwidth_hz = m.bandwidthHz;
  if (m.attackMs !== undefined && m.attackMs !== null) out.attack_ms = m.attackMs;
  if (m.decayMs !== undefined && m.decayMs !== null) out.decay_ms = m.decayMs;
  out.duration = m.duration;
  if (m.noiseFloorDbfs !== undefined && m.duration >= 1.0)
    out.noise_floor_dbfs = Math.max(m.noiseFloorDbfs, -120);
  out.width_db =
    m.sideToMidDb === undefined || m.sideToMidDb === null ? MONO_DB : Math.max(m.sideToMidDb, MONO_DB);
  const bands = m.bandsDb;
  if (bands) out.low_end_db = pyRoundTo(10 * Math.log10(10 ** (bands.sub / 10) + 10 ** (bands.low / 10)), 1);
  return out;
}
