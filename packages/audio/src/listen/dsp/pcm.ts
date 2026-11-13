// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The audio every listening DSP function takes, and the small numeric helpers that keep the port's numbers equal
 * to earshot's (ff41f07). earshot decodes everything to 48 kHz stereo float32, a mono file duplicated to both
 * channels at unity gain (audio.py `_decode`), so its levels sum two channels' power: a mono input here is
 * duplicated the same way, or its LUFS would read 3 dB low.
 */

/** earshot audio.SR. */
export const LISTEN_SR = 48_000;

/** Decoded PCM at 48 kHz: one channel (duplicated, as earshot does) or two of the same length. */
export interface ListenAudio {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

/** Two channels of one length; `left === right` for a mono source. */
export interface Stereo {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly length: number;
}

/** The input as earshot's (n, 2) decode. Throws on a wrong rate or ragged channels: the caller decodes at 48 kHz. */
export function stereoOf(audio: ListenAudio): Stereo {
  if (audio.sampleRate !== LISTEN_SR) {
    throw new Error(`listen DSP needs ${LISTEN_SR} Hz audio, got ${audio.sampleRate} Hz`);
  }
  const [left, right] = audio.channels;
  if (!left) return { left: new Float32Array(0), right: new Float32Array(0), length: 0 };
  if (right && right.length !== left.length) throw new Error('listen DSP needs channels of equal length');
  return { left, right: right ?? left, length: left.length };
}

/** `audio.to_mono(x)` on float32: `(l + r) / 2` summed in float32, as NumPy's mean over axis 1. */
export function monoOf(x: Stereo): Float32Array {
  if (x.left === x.right) return x.left;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.fround((x.left[i] ?? 0) + (x.right[i] ?? 0)) * 0.5;
  return out;
}

/** The mono signal in float64, for the parts upstream computes in float64. */
export function toFloat64(m: ArrayLike<number>): Float64Array {
  const out = new Float64Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = m[i] ?? 0;
  return out;
}

/** Python's `round(x)`: to the nearest integer, ties to even (JS rounds ties up). */
export function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff === 0.5) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(x);
}

/** Python's `round(x, digits)` for the output values (ties to even on the scaled value). */
export function roundTo(x: number, digits: number): number {
  const scale = 10 ** digits;
  return pyRound(x * scale) / scale;
}

/** `audio.db`: 20·log10, floored at 1e-12 (−240 dB). */
export function db(v: number, floor = 1e-12): number {
  return 20 * Math.log10(Math.max(v, floor));
}

/** Largest |sample| over both channels. */
export function peakOf(x: Stereo): number {
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x.left[i] ?? 0);
    const b = Math.abs(x.right[i] ?? 0);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  return peak;
}

/** A slice `[a, b)` of both channels (clamped), keeping mono shared. */
export function sliceStereo(x: Stereo, a: number, b: number): Stereo {
  const s = Math.max(0, Math.min(x.length, a));
  const e = Math.max(s, Math.min(x.length, b));
  const left = x.left.subarray(s, e);
  return { left, right: x.left === x.right ? left : x.right.subarray(s, e), length: e - s };
}
