// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The spectrograms earshot's DSP reads, as specs for the GPU graph (spectrogram-graph.ts) and its oracle:
 *
 * - `superflux`: timeline.log_mel, 1024-point Hann (NumPy's symmetric), 5 ms hop, 96 HTK mel bands 30 Hz–16 kHz, dB;
 * - `pulse`: the beat tracker's log-mel, 2048 points, 10 ms hop, 64 bands 30 Hz–8 kHz, dB;
 * - `downbeat`: 4096-point magnitudes summed into 12 pitch classes (55 Hz–2 kHz) and the lows (< 150 Hz);
 * - `brightness`: scipy.signal.stft's periodic Hann, 1024 points, hop 256, Σ|X| and Σ f·|X| per frame;
 * - `glide`: the audit's 1024-sample frames zero-padded to 8192, power over 80 Hz–10 kHz.
 *
 * Only the bins a projection reads are in the basis (the mel bank stops at 16 kHz, bin 341 of 513).
 */
import { hanningSymmetric, hannPeriodic } from './fft';
import { pyRound } from './pcm';
import { LISTEN_SR } from './pcm';
import type { Projection, SpectrogramSpec } from './transforms';
import { cqtOctaveSpec } from './cqt';

/** `np.fft.rfftfreq(n, 1 / SR)` as NumPy computes it (k · (1 / (n · d))). */
export function binFreqs(n: number, count = Math.floor(n / 2) + 1): Float64Array {
  const val = 1 / (n * (1 / LISTEN_SR));
  const f = new Float64Array(count);
  for (let k = 0; k < count; k++) f[k] = k * val;
  return f;
}

/** timeline._mel_fb as a [bins, nMels] projection (HTK mel, float32 like upstream's). */
export function htkMelProjection(
  nFft: number,
  nMels: number,
  fmin: number,
  fmax: number,
  bins: number,
): Projection {
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const a = mel(fmin);
  const b = mel(fmax);
  const count = nMels + 2;
  const step = (b - a) / (count - 1);
  const edges = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const m = i === count - 1 ? b : a + i * step;
    edges[i] = 700 * (10 ** (m / 2595) - 1);
  }
  const f = binFreqs(nFft, bins);
  const data = new Float64Array(bins * nMels);
  for (let m = 0; m < nMels; m++) {
    const lo = edges[m] ?? 0;
    const c = edges[m + 1] ?? 0;
    const hi = edges[m + 2] ?? 0;
    for (let k = 0; k < bins; k++) {
      const fk = f[k] ?? 0;
      const v = Math.max(0, Math.min((fk - lo) / (c - lo), (hi - fk) / (hi - c)));
      data[k * nMels + m] = Math.fround(v);
    }
  }
  return { rows: bins, columns: nMels, data };
}

const f32 = (w: Float64Array) => w.map((v) => Math.fround(v));

export function superfluxSpec(): SpectrogramSpec {
  const bins = 342;
  return {
    id: 'superflux',
    frameLength: 1024,
    transform: { kind: 'dft', nFft: 1024, window: f32(hanningSymmetric(1024)), firstBin: 0, bins },
    projection: htkMelProjection(1024, 96, 30, 16_000, bins),
    output: 'db',
  };
}

export function pulseSpec(): SpectrogramSpec {
  const bins = 342;
  return {
    id: 'pulse',
    frameLength: 2048,
    transform: { kind: 'dft', nFft: 2048, window: f32(hanningSymmetric(2048)), firstBin: 0, bins },
    projection: htkMelProjection(2048, 64, 30, 8000, bins),
    output: 'db',
  };
}

/** Columns 0–11: pitch class round(12·log2(f / 440)) mod 12 over 55 Hz–2 kHz; column 12: the lows under 150 Hz. */
export function downbeatSpec(): SpectrogramSpec {
  const bins = 171;
  const f = binFreqs(4096, bins);
  const data = new Float64Array(bins * 13);
  for (let k = 0; k < bins; k++) {
    const fk = f[k] ?? 0;
    if (fk >= 55 && fk <= 2000) {
      const pc = (((pyRound(12 * Math.log2(fk / 440)) % 12) + 12) % 12) as number;
      data[k * 13 + pc] = 1;
    }
    if (fk < 150) data[k * 13 + 12] = 1;
  }
  return {
    id: 'downbeat',
    frameLength: 4096,
    transform: { kind: 'dft', nFft: 4096, window: f32(hanningSymmetric(4096)), firstBin: 0, bins },
    projection: { rows: bins, columns: 13, data },
    output: 'magnitude',
  };
}

export function brightnessSpec(): SpectrogramSpec {
  const bins = 513;
  const f = binFreqs(1024, bins);
  const data = new Float64Array(bins * 2);
  for (let k = 0; k < bins; k++) {
    data[k * 2] = 1;
    data[k * 2 + 1] = f[k] ?? 0;
  }
  return {
    id: 'brightness',
    frameLength: 1024,
    transform: { kind: 'dft', nFft: 1024, window: hannPeriodic(1024), firstBin: 0, bins },
    projection: { rows: bins, columns: 2, data },
    output: 'magnitude',
  };
}

/** sfx.rising_glide's bins: searchsorted(f, [80, 10000]) of the 8192-point grid. */
export const GLIDE_FIRST_BIN = 14;
export const GLIDE_BINS = 1707 - GLIDE_FIRST_BIN;

export function glideSpec(): SpectrogramSpec {
  return {
    id: 'glide',
    frameLength: 1024,
    transform: {
      kind: 'dft',
      nFft: 8192,
      window: hanningSymmetric(1024),
      firstBin: GLIDE_FIRST_BIN,
      bins: GLIDE_BINS,
    },
    output: 'power',
  };
}

/** Every spec, for the graph-against-oracle test. */
export function listenSpectrogramSpecs(): SpectrogramSpec[] {
  return [superfluxSpec(), pulseSpec(), downbeatSpec(), brightnessSpec(), glideSpec(), cqtOctaveSpec(0)];
}
