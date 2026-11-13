// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two mel filterbanks, as transformers' `audio_utils.mel_filter_bank` builds them (f64, row-major
 * `[bins, mels]`): CLAP's Slaney scale with Slaney area normalisation (`truncation: rand_trunc`), and AST's Kaldi
 * scale triangularised in mel space (its NumPy fbank, which upstream's environment runs: it has no torchaudio).
 */
import { LISTEN_CONFIG } from '../config';

type MelScale = 'slaney' | 'kaldi';

function hertzToMel(freq: number, scale: MelScale): number {
  if (scale === 'kaldi') return 1127.0 * Math.log(1.0 + freq / 700.0);
  const minLogHertz = 1000.0;
  const minLogMel = 15.0;
  const logstep = 27.0 / Math.log(6.4);
  if (freq >= minLogHertz) return minLogMel + Math.log(freq / minLogHertz) * logstep;
  return (3.0 * freq) / 200.0;
}

function melToHertz(mel: number, scale: MelScale): number {
  if (scale === 'kaldi') return 700.0 * (Math.exp(mel / 1127.0) - 1.0);
  const minLogHertz = 1000.0;
  const minLogMel = 15.0;
  const logstep = Math.log(6.4) / 27.0;
  if (mel >= minLogMel) return minLogHertz * Math.exp(logstep * (mel - minLogMel));
  return (200.0 * mel) / 3.0;
}

/** NumPy's linspace (endpoint included): start + i·step, the last point exactly `stop`. */
function linspace(start: number, stop: number, count: number): Float64Array {
  const out = new Float64Array(count);
  const step = (stop - start) / (count - 1);
  for (let i = 0; i < count; i++) out[i] = start + i * step;
  out[count - 1] = stop;
  return out;
}

/** `_create_triangular_filter_bank`: max(0, min(down, up)), `[bins, mels]`. */
function triangles(fftFreqs: Float64Array, filterFreqs: Float64Array): Float64Array {
  const bins = fftFreqs.length;
  const mels = filterFreqs.length - 2;
  const out = new Float64Array(bins * mels);
  for (let b = 0; b < bins; b++) {
    const f = fftFreqs[b] ?? 0;
    for (let m = 0; m < mels; m++) {
      const lo = filterFreqs[m] ?? 0;
      const centre = filterFreqs[m + 1] ?? 0;
      const hi = filterFreqs[m + 2] ?? 0;
      const down = -(lo - f) / (centre - lo);
      const up = (hi - f) / (hi - centre);
      out[b * mels + m] = Math.max(0, Math.min(down, up));
    }
  }
  return out;
}

let clapBank: Float64Array | undefined;
let astBank: Float64Array | undefined;

/** CLAP: 513 bins × 64 mels, 50 Hz – 14 kHz at 48 kHz, Slaney scale and norm. */
export function clapMelBank(): Float64Array {
  if (clapBank) return clapBank;
  const { nFft, nMels, fMin, fMax } = LISTEN_CONFIG.clap;
  const bins = nFft / 2 + 1;
  const melFreqs = linspace(hertzToMel(fMin, 'slaney'), hertzToMel(fMax, 'slaney'), nMels + 2);
  const filterFreqs = melFreqs.map((mel) => melToHertz(mel, 'slaney'));
  const fftFreqs = linspace(0, Math.floor(LISTEN_CONFIG.sampleRate / 2), bins);
  const bank = triangles(fftFreqs, filterFreqs);
  for (let m = 0; m < nMels; m++) {
    const enorm = 2.0 / ((filterFreqs[m + 2] ?? 0) - (filterFreqs[m] ?? 0));
    for (let b = 0; b < bins; b++) bank[b * nMels + m] = (bank[b * nMels + m] ?? 0) * enorm;
  }
  clapBank = bank;
  return bank;
}

/** AST: 257 bins × 128 mels, 20 Hz – 8 kHz at 16 kHz, Kaldi scale, triangles in mel space, no norm. */
export function astMelBank(): Float64Array {
  if (astBank) return astBank;
  const { fftLength, nMels, fMin, sampleRate } = LISTEN_CONFIG.ast;
  const bins = fftLength / 2 + 1;
  const melFreqs = linspace(hertzToMel(fMin, 'kaldi'), hertzToMel(sampleRate / 2, 'kaldi'), nMels + 2);
  const binWidth = sampleRate / ((bins - 1) * 2);
  const fftMels = new Float64Array(bins);
  for (let b = 0; b < bins; b++) fftMels[b] = hertzToMel(binWidth * b, 'kaldi');
  astBank = triangles(fftMels, melFreqs);
  return astBank;
}
