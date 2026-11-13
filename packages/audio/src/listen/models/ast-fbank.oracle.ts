// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AST's Kaldi fbank in f64, step by step as transformers' ASTFeatureExtractor runs it without torchaudio (upstream's
 * environment): `ast._forward` zero-pads to 0.1 s; frames of 400 every 160 with no centring; per frame the DC
 * removed, a 0.97 pre-emphasis, the symmetric Hann, a 512-point |rfft|², the Kaldi bank, a float32-epsilon floor and
 * ln; then zero rows to 1024 frames (or a cut) and `(x − mean) / (2·std)`. The graph (ast-fbank.ts) is tested
 * against it, and it runs when the graph would have to run on the CPU.
 */
import { LISTEN_CONFIG } from '../config';
import { createRealFft } from './fft';
import { astMelBank } from './mel-banks';

const { frameLength, frameShift, fftLength, nMels, maxFrames, mean, std, preemphasis, melFloor, minSamples } =
  LISTEN_CONFIG.ast;

/** How many real frames a 16 kHz segment gives (before the pad or cut to 1024). */
export function astFrameCount(samples: number): number {
  const length = Math.max(samples, minSamples);
  return 1 + Math.floor((length - frameLength) / frameShift);
}

/** `[1024, 128]` row-major, as the model's `input_values[b]`. */
export function astFbankOracle(segment16k: Float32Array): Float32Array {
  const length = Math.max(segment16k.length, minSamples);
  const count = astFrameCount(segment16k.length);
  const fft = createRealFft(fftLength);
  const bank = astMelBank();
  const bins = fftLength / 2 + 1;
  const window = new Float64Array(frameLength);
  for (let n = 0; n < frameLength; n++)
    window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (frameLength - 1));
  const buffer = new Float64Array(fftLength);
  const power = new Float64Array(bins);
  const out = new Float32Array(maxFrames * nMels);
  const padded = -mean / (2 * std);
  out.fill(padded);
  for (let frame = 0; frame < Math.min(count, maxFrames); frame++) {
    const start = frame * frameShift;
    let sum = 0;
    for (let n = 0; n < frameLength; n++) {
      const i = start + n;
      const x = i < length ? (segment16k[i] ?? 0) : 0;
      buffer[n] = x;
      sum += x;
    }
    const dc = sum / frameLength;
    for (let n = 0; n < frameLength; n++) buffer[n] = (buffer[n] ?? 0) - dc;
    for (let n = frameLength - 1; n >= 1; n--)
      buffer[n] = (buffer[n] ?? 0) - preemphasis * (buffer[n - 1] ?? 0);
    buffer[0] = (buffer[0] ?? 0) * (1 - preemphasis);
    for (let n = 0; n < frameLength; n++) buffer[n] = (buffer[n] ?? 0) * (window[n] ?? 0);
    buffer.fill(0, frameLength);
    fft.power(buffer, power);
    for (let m = 0; m < nMels; m++) {
      let acc = 0;
      for (let k = 0; k < bins; k++) {
        const w = bank[k * nMels + m] ?? 0;
        if (w !== 0) acc += w * (power[k] ?? 0);
      }
      out[frame * nMels + m] = (Math.log(Math.max(melFloor, acc)) - mean) / (2 * std);
    }
  }
  return out;
}
