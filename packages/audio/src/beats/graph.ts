// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * GPU-shaped log-mel: a strided valid conv with a windowed DFT basis (the Hann
 * is baked into the kernels), then magnitude, the filterbank MatMul and log1p.
 * Pad, frame count and onset live here on purpose. Sharing them with the oracle
 * would let one bug pass both sides of the equality test.
 */
import { AUDIO_CONFIG } from '../config';

const { nFft, hop, nMels, nFreq } = AUDIO_CONFIG.beats;

export interface BeatFrontEnd {
  run(samples: Float32Array): { logMel: Float32Array; frames: number; onset: Float32Array };
}

interface Kernels {
  readonly real: Float64Array;
  readonly imag: Float64Array;
}

function reflectIndex(index: number, length: number): number {
  if (length <= 1) return 0;
  const period = 2 * (length - 1);
  let i = index % period;
  if (i < 0) i += period;
  if (i >= length) i = period - i;
  return i;
}

/** NumPy `reflect`. The edge sample is not repeated. Empty audio pads as zeros. */
function reflectPad(samples: Float32Array, pad: number): Float64Array {
  const length = samples.length;
  const out = new Float64Array(length + pad * 2);
  if (length === 0) return out;
  for (let i = 0; i < pad; i++) out[i] = samples[reflectIndex(i - pad, length)] ?? 0;
  for (let i = 0; i < length; i++) out[pad + i] = samples[i] ?? 0;
  for (let i = 0; i < pad; i++) out[pad + length + i] = samples[reflectIndex(length + i, length)] ?? 0;
  return out;
}

function frameCount(sampleCount: number): number {
  return 1 + Math.floor(sampleCount / hop);
}

/** Reflect-padded windows, row-major `[frames, nFft]`. The same pad as `run`. */
export function stftFrames(samples: Float32Array): Float32Array {
  const padded = reflectPad(samples, nFft / 2);
  const frames = frameCount(samples.length);
  const out = new Float32Array(frames * nFft);
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop;
    for (let n = 0; n < nFft; n++) out[frame * nFft + n] = padded[start + n] ?? 0;
  }
  return out;
}

export function onsetOf(logMel: Float32Array, nFrames: number): Float32Array {
  const onset = new Float32Array(nFrames);
  for (let t = 1; t < nFrames; t++) {
    let sum = 0;
    const row = t * nMels;
    const prev = row - nMels;
    for (let m = 0; m < nMels; m++) {
      const delta = (logMel[row + m] ?? 0) - (logMel[prev + m] ?? 0);
      if (delta > 0) sum += delta;
    }
    onset[t] = sum;
  }
  return onset;
}

function windowedBasis(): Kernels {
  const real = new Float64Array(nFreq * nFft);
  const imag = new Float64Array(nFreq * nFft);
  for (let n = 0; n < nFft; n++) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / nFft);
    for (let k = 0; k < nFreq; k++) {
      const angle = (2 * Math.PI * k * n) / nFft;
      real[k * nFft + n] = window * Math.cos(angle);
      imag[k * nFft + n] = window * Math.sin(angle);
    }
  }
  return { real, imag };
}

export function beatFrontEndGraph(filterbank: Float32Array): BeatFrontEnd {
  const kernels = windowedBasis();
  const scale = Math.sqrt(nFft);
  return {
    run(samples: Float32Array) {
      const padded = reflectPad(samples, nFft / 2);
      const frames = frameCount(samples.length);
      const logMel = new Float32Array(frames * nMels);
      const mag = new Float64Array(nFreq);
      for (let frame = 0; frame < frames; frame++) {
        const start = frame * hop;
        for (let k = 0; k < nFreq; k++) {
          let re = 0;
          let im = 0;
          const bin = k * nFft;
          for (let n = 0; n < nFft; n++) {
            const x = padded[start + n] ?? 0;
            re += x * (kernels.real[bin + n] ?? 0);
            im -= x * (kernels.imag[bin + n] ?? 0);
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
      return { logMel, frames, onset: onsetOf(logMel, frames) };
    },
  };
}
