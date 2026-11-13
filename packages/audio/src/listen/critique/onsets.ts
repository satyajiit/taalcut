// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The onsets earshot's critique counts (profile `_audio_pass`): librosa 1.0's `onset_strength` and `onset_detect`
 * on a 22.05 kHz copy of the mono mix (soxr HQ, realness/resample.ts), hop 256, then each onset moved to its attack
 * (`attack_times`). These are not the timeline's superflux events: the launch profile's onset density and "sound on
 * cuts" ranges were measured with librosa's detector, so the critique ports it rather than mapping onto F6's
 * events (their counts differ by up to 2× on the fixture films).
 *
 * onset_strength: a 2048-point STFT (periodic Hann, zero-padded centred frames) → power → 128 Slaney mel bands to
 * 11.025 kHz (float32 weights, Slaney area norm) → dB (amin 1e-10, ref 1, floored 80 dB under the maximum) → the
 * mean over bands of each band's rise since the previous frame, shifted 5 frames late (lag 1 + n_fft / 2 / hop) and
 * trimmed to the frame count. The STFT and mel projection run on the spectrogram runner (GPU first).
 * onset_detect: the envelope min–max normalised, then the greedy peak picker (pre_max 2, post_max 1, pre_avg 8,
 * post_avg 9, wait 2, delta 0.07).
 */
import { hannPeriodic } from '../dsp/fft';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import { centredFrames, type Projection, type SpectrogramSpec } from '../dsp/transforms';
import { pyRoundTo } from '../realness/py-round';

/** profile.HR and HOP. */
export const ONSET_SR = 22_050;
export const ONSET_HOP = 256;
const N_FFT = 2048;
const N_MELS = 128;
const BINS = N_FFT / 2 + 1;
/** float32's smallest normal value (librosa util.tiny). */
const TINY_F32 = 1.1754943508222875e-38;

/** librosa's Slaney mel scale (`hz_to_mel`, htk=False). */
function hzToMel(f: number): number {
  const fsp = 200 / 3;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fsp;
  const logstep = Math.log(6.4) / 27;
  return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logstep : f / fsp;
}

function melToHz(m: number): number {
  const fsp = 200 / 3;
  const minLogHz = 1000;
  const minLogMel = minLogHz / fsp;
  const logstep = Math.log(6.4) / 27;
  return m >= minLogMel ? minLogHz * Math.exp(logstep * (m - minLogMel)) : fsp * m;
}

/** `librosa.filters.mel(sr=22050, n_fft=2048, n_mels=128)` as a [1025, 128] projection (float32 weights). */
export function librosaMelProjection(): Projection {
  const count = N_MELS + 2;
  const lo = hzToMel(0);
  const hi = hzToMel(ONSET_SR / 2);
  // np.linspace: start + i·step, the last point exactly `hi`.
  const step = (hi - lo) / (count - 1);
  const melF = Float64Array.from({ length: count }, (_, i) => melToHz(i === count - 1 ? hi : lo + i * step));
  const fft = Float64Array.from({ length: BINS }, (_, k) => k * (1 / (N_FFT * (1 / ONSET_SR))));
  const data = new Float64Array(BINS * N_MELS);
  for (let m = 0; m < N_MELS; m++) {
    const f0 = melF[m] ?? 0;
    const f1 = melF[m + 1] ?? 0;
    const f2 = melF[m + 2] ?? 0;
    const enorm = 2 / (f2 - f0);
    for (let k = 0; k < BINS; k++) {
      const fk = fft[k] ?? 0;
      const lower = -(f0 - fk) / (f1 - f0);
      const upper = (f2 - fk) / (f2 - f1);
      const w = Math.fround(Math.max(0, Math.min(lower, upper)));
      data[k * N_MELS + m] = Math.fround(w * enorm);
    }
  }
  return { rows: BINS, columns: N_MELS, data };
}

export function librosaMelSpec(): SpectrogramSpec {
  return {
    id: 'librosa-mel',
    frameLength: N_FFT,
    transform: {
      kind: 'dft',
      nFft: N_FFT,
      window: hannPeriodic(N_FFT).map((v) => Math.fround(v)),
      firstBin: 0,
      bins: BINS,
    },
    projection: librosaMelProjection(),
    output: 'power',
  };
}

/** `librosa.onset.onset_strength(y=y22, sr=22050, hop_length=256)`, one value per frame (float32). */
export async function onsetStrength(y22: Float32Array, runner: SpectrogramRunner): Promise<Float32Array> {
  const out = await runner.spectrogram(librosaMelSpec(), centredFrames(y22, N_FFT, ONSET_HOP, 'constant'));
  const { frames, columns, data } = out;
  const db = new Float64Array(data.length);
  let top = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = 10 * Math.log10(Math.max(1e-10, data[i] ?? 0));
    db[i] = v;
    if (v > top) top = v;
  }
  const floor = top - 80;
  for (let i = 0; i < db.length; i++) db[i] = Math.max(db[i] ?? floor, floor);
  const env = new Float32Array(frames);
  const shift = 1 + N_FFT / (2 * ONSET_HOP);
  for (let t = 1; t + shift - 1 < frames; t++) {
    let sum = 0;
    for (let b = 0; b < columns; b++) {
      const d = (db[t * columns + b] ?? 0) - (db[(t - 1) * columns + b] ?? 0);
      if (d > 0) sum += d;
    }
    env[t - 1 + shift] = sum / columns;
  }
  return env;
}

/** librosa's greedy `peak_pick` on a normalised envelope: the picked frames. */
export function peakPick(
  x: ArrayLike<number>,
  o: { preMax: number; postMax: number; preAvg: number; postAvg: number; delta: number; wait: number },
): number[] {
  const n = x.length;
  const maxIn = (a: number, b: number) => {
    let m = -Infinity;
    for (let i = a; i < b; i++) m = Math.max(m, x[i] ?? -Infinity);
    return m;
  };
  const meanIn = (a: number, b: number) => {
    let s = 0;
    for (let i = a; i < b; i++) s += x[i] ?? 0;
    return s / (b - a);
  };
  const peaks: number[] = [];
  const x0 = x[0] ?? 0;
  let k = 1;
  if (n > 0 && x0 >= maxIn(0, Math.min(o.postMax, n)) && x0 >= meanIn(0, Math.min(o.postAvg, n)) + o.delta) {
    peaks.push(0);
    k = o.wait + 1;
  }
  while (k < n) {
    const xk = x[k] ?? 0;
    if (xk !== maxIn(Math.max(0, k - o.preMax), Math.min(k + o.postMax, n))) {
      k += 1;
      continue;
    }
    if (!(xk >= meanIn(Math.max(0, k - o.preAvg), Math.min(k + o.postAvg, n)) + o.delta)) {
      k += 1;
      continue;
    }
    peaks.push(k);
    k += o.wait + 1;
  }
  return peaks;
}

/** `librosa.onset.onset_detect(onset_envelope=env, sr=22050, hop_length=256, units='time')`. */
export function onsetDetect(env: Float32Array): number[] {
  if (env.length === 0) return [];
  let lo = Infinity;
  for (const v of env) lo = Math.min(lo, v);
  const norm = env.map((v) => v - lo);
  let hi = -Infinity;
  for (const v of norm) hi = Math.max(hi, v);
  const scale = Math.fround(hi + TINY_F32);
  for (let i = 0; i < norm.length; i++) norm[i] = (norm[i] ?? 0) / scale;
  if (!norm.some((v) => v !== 0) || norm.some((v) => !Number.isFinite(v))) return [];
  const rate = ONSET_SR / ONSET_HOP;
  const frames = peakPick(norm, {
    preMax: Math.ceil(Math.floor(0.03 * rate)),
    postMax: 1,
    preAvg: Math.ceil(Math.floor(0.1 * rate)),
    postAvg: Math.ceil(Math.floor(0.1 * rate)) + 1,
    delta: 0.07,
    wait: Math.ceil(Math.floor(0.03 * rate)),
  });
  return frames.map((f) => (f * ONSET_HOP) / ONSET_SR);
}

/** The 2 ms frame of profile.E2. */
export const ATTACK_FRAME_S = 0.002;

/**
 * profile.attack_times: each time moved to the steepest rise of the 2 ms level within 60 ms before to 20 ms after
 * (spectral-flux peaks lag the attack by 10–30 ms), rounded to 0.1 ms.
 */
export function attackTimes(times: readonly number[], e2: Float32Array, h = ATTACK_FRAME_S): number[] {
  return times.map((t) => {
    const a = Math.max(1, Math.trunc((t - 0.06) / h));
    const b = Math.min(e2.length - 1, Math.trunc((t + 0.02) / h) + 1);
    if (b - a < 2) return t;
    let best = 0;
    let bestD = -Infinity;
    for (let i = a; i <= b; i++) {
      const d = (e2[i] ?? 0) - (e2[i - 1] ?? 0);
      if (d > bestD) {
        bestD = d;
        best = i - a;
      }
    }
    return pyRoundTo((a + best) * h, 4);
  });
}
