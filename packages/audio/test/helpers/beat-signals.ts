// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Deterministic mono signals at Beat This!'s 22.05 kHz for the WebGPU/CPU parity check: a click track and a
 * small "groove" (kick on the beat, seeded noise hats between, a held minor chord, a quiet noise floor), so the
 * model sees something closer to music than clicks alone. Same seed, same samples, on every machine.
 */
import { AUDIO_CONFIG } from '../../src/config';

const RATE = AUDIO_CONFIG.beats.sampleRate;

/** mulberry32: a tiny seeded generator, uniform in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 8 ms 880 Hz bursts, first at `offsetSeconds`. */
export function beatClicks(bpm: number, seconds: number, offsetSeconds = 0.5): Float32Array {
  const samples = new Float32Array(Math.round(RATE * seconds));
  const period = Math.round((RATE * 60) / bpm);
  const click = Math.round(RATE * 0.008);
  for (let start = Math.round(RATE * offsetSeconds); start + click < samples.length; start += period) {
    for (let k = 0; k < click; k++) samples[start + k] = Math.sin((2 * Math.PI * 880 * (start + k)) / RATE);
  }
  return samples;
}

function addKick(out: Float32Array, at: number, gain: number): void {
  const length = Math.round(RATE * 0.18);
  for (let k = 0; k < length && at + k < out.length; k++) {
    // A falling 110 → 45 Hz sweep, the usual synthetic kick.
    const t = k / RATE;
    const freq = 45 + 65 * Math.exp(-t * 30);
    out[at + k] = (out[at + k] ?? 0) + gain * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 18);
  }
}

function addHat(out: Float32Array, at: number, gain: number, random: () => number): void {
  const length = Math.round(RATE * 0.04);
  for (let k = 0; k < length && at + k < out.length; k++) {
    out[at + k] = (out[at + k] ?? 0) + gain * (random() * 2 - 1) * Math.exp(-k / (RATE * 0.008));
  }
}

/** Kick on every beat (louder on the bar), hats on the off-beats, an A minor pad and a noise floor. */
export function groove(bpm: number, seconds: number, seed: number): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(Math.round(RATE * seconds));
  const chord = [220, 261.63, 329.63];
  for (let i = 0; i < out.length; i++) {
    let pad = 0;
    for (const freq of chord) pad += Math.sin((2 * Math.PI * freq * i) / RATE);
    out[i] = 0.05 * pad + 0.01 * (random() * 2 - 1);
  }
  const beat = (RATE * 60) / bpm;
  for (let n = 0; Math.round(RATE * 0.25 + n * beat) < out.length; n++) {
    const at = Math.round(RATE * 0.25 + n * beat);
    addKick(out, at, n % 4 === 0 ? 0.9 : 0.6);
    addHat(out, Math.round(at + beat / 2), 0.25, random);
  }
  return out;
}
