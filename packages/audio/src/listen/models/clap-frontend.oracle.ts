// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CLAP's log-mel in f64, step by step as earshot feeds transformers' ClapFeatureExtractor: `clap._prep` (zero-pad to
 * 10 ms, cut at 10 s), `repeatpad` (tile ⌊480000 / n⌋ times, zero-pad to 10 s), then `spectrogram`: centred frames
 * with a reflect pad, the periodic Hann, |rfft|², the Slaney bank, a 1e-10 floor and 10·log10. The reference the
 * graph (clap-frontend.ts) is tested against, and what runs when the graph would have to run on the CPU.
 */
import { LISTEN_CONFIG } from '../config';
import { createRealFft } from './fft';
import { clapMelBank } from './mel-banks';

const { nFft, hop, nMels, maxSamples, frames, minSamples, powerFloor } = LISTEN_CONFIG.clap;

/** The 10 s the extractor turns into features: the segment, repeat-padded (earshot's default `repeatpad`). */
export function clapInputWaveform(segment: Float32Array): Float64Array {
  const length = Math.min(Math.max(segment.length, minSamples), maxSamples);
  const out = new Float64Array(maxSamples);
  const repeats = length < maxSamples ? Math.floor(maxSamples / length) : 1;
  for (let r = 0; r < repeats; r++) {
    const offset = r * length;
    for (let i = 0; i < length; i++) out[offset + i] = i < segment.length ? (segment[i] ?? 0) : 0;
  }
  return out;
}

function reflected(index: number, length: number): number {
  const period = 2 * (length - 1);
  let i = index % period;
  if (i < 0) i += period;
  return i >= length ? period - i : i;
}

/** `[frames, 64]` row-major, as the model's `input_features[b, 0]`. */
export function clapLogMelOracle(segment: Float32Array): Float32Array {
  const wave = clapInputWaveform(segment);
  const pad = nFft / 2;
  const fft = createRealFft(nFft);
  const bank = clapMelBank();
  const bins = nFft / 2 + 1;
  const window = new Float64Array(nFft);
  for (let n = 0; n < nFft; n++) window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / nFft);
  const buffer = new Float64Array(nFft);
  const power = new Float64Array(bins);
  const out = new Float32Array(frames * nMels);
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop - pad;
    for (let n = 0; n < nFft; n++)
      buffer[n] = (wave[reflected(start + n, maxSamples)] ?? 0) * (window[n] ?? 0);
    fft.power(buffer, power);
    for (let m = 0; m < nMels; m++) {
      let acc = 0;
      for (let k = 0; k < bins; k++) {
        const w = bank[k * nMels + m] ?? 0;
        if (w !== 0) acc += w * (power[k] ?? 0);
      }
      out[frame * nMels + m] = 10 * Math.log10(Math.max(powerFloor, acc));
    }
  }
  return out;
}
