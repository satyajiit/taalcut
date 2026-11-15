// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: what the bar finder reads from the samples (find-bars.ts). Mono 48 kHz in; every 5 ms a 1024-point Hann
 * frame, its power summed into 32 bands spaced by the logarithm of frequency from 40 Hz to 16 kHz, in dB with a
 * floor 80 dB under the loudest band of the file. From those: how much each frame rose over the frame 10 ms
 * before it, over all bands (`rise`), under 200 Hz (`lowRise`, a kick or a bass note), from there to 2 kHz and
 * above it. No model: a few thousand small FFTs per minute of sound, on the CPU in f64, as the sections' novelty
 * curve is (listen/timeline).
 */
import { createRealFft } from '../listen/models/fft';

export const BARS_SAMPLE_RATE = 48_000;
/** Samples between frames: 5 ms. */
export const BARS_HOP = 240;
export const BARS_FRAME_SECONDS = BARS_HOP / BARS_SAMPLE_RATE;
export const BARS_BANDS = 32;

const N_FFT = 1024;
const F_MIN = 40;
const F_MAX = 16_000;
const LOW_HZ = 200;
const HIGH_HZ = 2000;
const FLOOR_DB = 80;
/** A frame is compared with the one this many frames (10 ms) before it. */
const RISE_LAG = 2;

export interface BandSpectrum {
  /** Row-major [frames, BARS_BANDS], dB, floored. Frame i is centred at i · 5 ms. */
  readonly bands: Float64Array;
  readonly frames: number;
  /** Each frame's rise over the frame 10 ms before, averaged over the bands, in dB. */
  readonly rise: Float64Array;
  /** The same under 200 Hz. */
  readonly lowRise: Float64Array;
  /** The same from 200 Hz to 2 kHz, and above 2 kHz: with `lowRise`, which part of the sound hit. */
  readonly midRise: Float64Array;
  readonly highRise: Float64Array;
}

/** The first FFT bin of each band, and one past the last band's. */
function bandEdges(): number[] {
  const bins = N_FFT / 2;
  const edges: number[] = [];
  for (let band = 0; band <= BARS_BANDS; band++) {
    const hz = F_MIN * (F_MAX / F_MIN) ** (band / BARS_BANDS);
    edges.push(Math.min(bins, Math.max(1, Math.round((hz * N_FFT) / BARS_SAMPLE_RATE))));
  }
  // A band holds at least one bin: the lowest bands are narrower than a bin at this size.
  for (let band = 1; band <= BARS_BANDS; band++)
    edges[band] = Math.min(bins, Math.max(edges[band] ?? 0, (edges[band - 1] ?? 0) + 1));
  return edges;
}

export function bandSpectrum(mono: Float32Array): BandSpectrum {
  const frames = Math.max(0, Math.floor(mono.length / BARS_HOP) + 1);
  const bands = new Float64Array(frames * BARS_BANDS);
  const fft = createRealFft(N_FFT);
  const window = Float64Array.from(
    { length: N_FFT },
    (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N_FFT - 1)),
  );
  const buffer = new Float64Array(N_FFT);
  const power = new Float64Array(N_FFT / 2 + 1);
  const edges = bandEdges();
  const under = (hz: number) => edges.filter((bin) => (bin * BARS_SAMPLE_RATE) / N_FFT < hz).length;
  const lowBands = under(LOW_HZ);
  const midBands = Math.min(BARS_BANDS, under(HIGH_HZ));
  let top = -Infinity;
  for (let frame = 0; frame < frames; frame++) {
    const first = frame * BARS_HOP - N_FFT / 2;
    for (let n = 0; n < N_FFT; n++) buffer[n] = (mono[first + n] ?? 0) * (window[n] ?? 0);
    fft.power(buffer, power);
    for (let band = 0; band < BARS_BANDS; band++) {
      let sum = 0;
      for (let bin = edges[band] ?? 0; bin < (edges[band + 1] ?? 0); bin++) sum += power[bin] ?? 0;
      const level = 10 * Math.log10(sum + 1e-12);
      bands[frame * BARS_BANDS + band] = level;
      if (level > top) top = level;
    }
  }
  const floor = top - FLOOR_DB;
  for (let i = 0; i < bands.length; i++) if ((bands[i] ?? floor) < floor) bands[i] = floor;
  const rise = new Float64Array(frames);
  const lowRise = new Float64Array(frames);
  const midRise = new Float64Array(frames);
  const highRise = new Float64Array(frames);
  for (let frame = RISE_LAG; frame < frames; frame++) {
    let low = 0;
    let mid = 0;
    let high = 0;
    for (let band = 0; band < BARS_BANDS; band++) {
      const d =
        (bands[frame * BARS_BANDS + band] ?? 0) - (bands[(frame - RISE_LAG) * BARS_BANDS + band] ?? 0);
      if (d <= 0) continue;
      if (band < lowBands) low += d;
      else if (band < midBands) mid += d;
      else high += d;
    }
    rise[frame] = (low + mid + high) / BARS_BANDS;
    lowRise[frame] = low / Math.max(1, lowBands);
    midRise[frame] = mid / Math.max(1, midBands - lowBands);
    highRise[frame] = high / Math.max(1, BARS_BANDS - midBands);
  }
  return { bands, frames, rise, lowRise, midRise, highRise };
}

/** The mean band levels over frames [from, to), in dB; null when the stretch holds no frame. */
export function meanBands(spectrum: BandSpectrum, from: number, to: number): Float64Array | null {
  const a = Math.max(0, Math.round(from));
  const b = Math.min(spectrum.frames, Math.round(to));
  if (b <= a) return null;
  const out = new Float64Array(BARS_BANDS);
  for (let frame = a; frame < b; frame++)
    for (let band = 0; band < BARS_BANDS; band++)
      out[band] = (out[band] ?? 0) + (spectrum.bands[frame * BARS_BANDS + band] ?? 0);
  for (let band = 0; band < BARS_BANDS; band++) out[band] = (out[band] ?? 0) / (b - a);
  return out;
}

/** How far two stretches' band levels are apart: the mean of the bands' differences, in dB (0: the same sound). */
export function bandsApart(a: Float64Array | null, b: Float64Array | null): number | null {
  if (!a || !b) return null;
  let sum = 0;
  for (let band = 0; band < BARS_BANDS; band++) sum += Math.abs((a[band] ?? 0) - (b[band] ?? 0));
  return sum / BARS_BANDS;
}

/** The level of samples [from, to) in dBFS (RMS), floored at −120; null for an empty stretch. */
export function levelDb(mono: Float32Array, from: number, to: number): number | null {
  const a = Math.max(0, Math.round(from));
  const b = Math.min(mono.length, Math.round(to));
  if (b <= a) return null;
  let sum = 0;
  for (let i = a; i < b; i++) sum += (mono[i] ?? 0) ** 2;
  return Math.max(-120, 10 * Math.log10(sum / (b - a) + 1e-12));
}
