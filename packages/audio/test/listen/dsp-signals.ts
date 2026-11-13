// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Synthetic 48 kHz signals with known answers for the listen DSP tests. */
import type { ListenAudio } from '../../src/listen/dsp/pcm';

export const SR = 48_000;

export function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SR));
}

export function tone(hz: number, seconds: number, amp = 0.5, phase = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR + phase);
  return out;
}

/** A seeded uniform noise (mulberry32), so every run sees the same samples. */
export function noise(seconds: number, amp = 0.1, seed = 1): Float32Array {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amp * (2 * next() - 1);
  return out;
}

/** Adds `src` into `dst` at `atS` seconds. */
export function mixAt(dst: Float32Array, src: Float32Array, atS: number, gain = 1): Float32Array {
  const at = Math.round(atS * SR);
  for (let i = 0; i < src.length && at + i < dst.length; i++)
    dst[at + i] = (dst[at + i] ?? 0) + gain * (src[i] ?? 0);
  return dst;
}

/** A short percussive hit: a decaying noise burst with a 1 kHz body, 80 ms. */
export function hit(amp = 0.8, seed = 3): Float32Array {
  const n = noise(0.08, 1, seed);
  const out = new Float32Array(n.length);
  for (let i = 0; i < n.length; i++) {
    const env = Math.exp(-i / (0.012 * SR));
    out[i] = amp * env * (0.6 * (n[i] ?? 0) + 0.4 * Math.sin((2 * Math.PI * 1000 * i) / SR));
  }
  return out;
}

/** Hits at the given times over a quiet noise bed. */
export function hitsAt(times: readonly number[], seconds: number, bedAmp = 0.002): Float32Array {
  const out = noise(seconds, bedAmp, 99);
  times.forEach((t, i) => mixAt(out, hit(0.8, 10 + i), t));
  return out;
}

/** A click track: 5 ms decaying clicks every 60 / bpm seconds from `startS`, accented every 4th. */
export function clickTrack(bpm: number, seconds: number, startS = 0.1): Float32Array {
  const out = noise(seconds, 0.001, 5);
  for (let t = startS, k = 0; t < seconds - 0.05; t += 60 / bpm, k++)
    mixAt(out, hit(k % 4 === 0 ? 0.9 : 0.5, 20 + (k % 7)), t);
  return out;
}

export function mono(samples: Float32Array): ListenAudio {
  return { sampleRate: SR, channels: [samples] };
}

export function stereo(left: Float32Array, right: Float32Array): ListenAudio {
  return { sampleRate: SR, channels: [left, right] };
}
