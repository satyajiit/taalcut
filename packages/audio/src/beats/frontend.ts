// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CPU log-mel oracle for Beat This! (spike 05). Periodic Hann, centred reflect
 * pad, magnitude / √nFft, then log1p(1000 · mel). The graph must not call this.
 */
import { AUDIO_CONFIG } from '../config';

const { nFft, hop, nMels, nFreq } = AUDIO_CONFIG.beats;

interface DftBasis {
  readonly cos: Float64Array;
  readonly sin: Float64Array;
  readonly window: Float64Array;
}

let cached: DftBasis | undefined;

function basis(): DftBasis {
  if (cached) return cached;
  const window = new Float64Array(nFft);
  const cos = new Float64Array(nFreq * nFft);
  const sin = new Float64Array(nFreq * nFft);
  for (let i = 0; i < nFft; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nFft);
  for (let k = 0; k < nFreq; k++) {
    for (let n = 0; n < nFft; n++) {
      const angle = (2 * Math.PI * k * n) / nFft;
      cos[k * nFft + n] = Math.cos(angle);
      sin[k * nFft + n] = Math.sin(angle);
    }
  }
  cached = { cos, sin, window };
  return cached;
}

/** NumPy `reflect`: the edge sample is not repeated. Empty audio pads as zeros. */
export function reflectPad(samples: Float32Array, pad: number): Float64Array {
  const length = samples.length;
  const out = new Float64Array(length + pad * 2);
  if (length === 0) return out;
  for (let i = 0; i < pad; i++) out[i] = samples[reflectIndex(i - pad, length)] ?? 0;
  for (let i = 0; i < length; i++) out[pad + i] = samples[i] ?? 0;
  for (let i = 0; i < pad; i++) out[pad + length + i] = samples[reflectIndex(length + i, length)] ?? 0;
  return out;
}

function reflectIndex(index: number, length: number): number {
  if (length <= 1) return 0;
  const period = 2 * (length - 1);
  let i = index % period;
  if (i < 0) i += period;
  if (i >= length) i = period - i;
  return i;
}

export function frameCount(sampleCount: number): number {
  return 1 + Math.floor(sampleCount / hop);
}

/** Row-major `[frames, 128]` of `log1p(1000 · mel)`. `filterbank` is `[513, 128]`. */
export function referenceLogMel(samples: Float32Array, filterbank: Float32Array): Float32Array {
  const { cos, sin, window } = basis();
  const padded = reflectPad(samples, nFft / 2);
  const frames = frameCount(samples.length);
  const logMel = new Float32Array(frames * nMels);
  const scale = Math.sqrt(nFft);
  const mag = new Float64Array(nFreq);
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop;
    for (let k = 0; k < nFreq; k++) {
      let re = 0;
      let im = 0;
      const bin = k * nFft;
      for (let n = 0; n < nFft; n++) {
        const x = (padded[start + n] ?? 0) * (window[n] ?? 0);
        re += x * (cos[bin + n] ?? 0);
        im -= x * (sin[bin + n] ?? 0);
      }
      mag[k] = Math.hypot(re, im) / scale;
    }
    const row = frame * nMels;
    for (let m = 0; m < nMels; m++) {
      let acc = 0;
      for (let k = 0; k < nFreq; k++) acc += (mag[k] ?? 0) * (filterbank[k * nMels + m] ?? 0);
      logMel[row + m] = Math.log1p(1000 * acc);
    }
  }
  return logMel;
}

/** Half-wave rectified mel difference, summed over bins. Frame 0 is 0. */
export function onsetStrength(logMel: Float32Array, nFrames: number, melBins: number): Float32Array {
  const onset = new Float32Array(nFrames);
  for (let t = 1; t < nFrames; t++) {
    let sum = 0;
    const row = t * melBins;
    const prev = row - melBins;
    for (let m = 0; m < melBins; m++) {
      const delta = (logMel[row + m] ?? 0) - (logMel[prev + m] ?? 0);
      if (delta > 0) sum += delta;
    }
    onset[t] = sum;
  }
  return onset;
}
