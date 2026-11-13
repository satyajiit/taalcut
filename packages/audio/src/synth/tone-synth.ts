// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tone.js-style offline procedural synthesizer (`synthesizeProceduralSfx`, `encodePcm16Wav`).
 * Generates deterministic, BPM- and duration-locked 48 kHz mono/stereo sound effects (`whoosh`, `riser`,
 * `impact`, `hit`, `ui-click`, `synth-swell`, `sub-drop`) with biquad filter sweeps, FM/membrane oscillators,
 * shaped noise, and ITU-R BS.1770-4 loudness normalization.
 */
import { synthSfxSpecSchema, type SynthSfxCategory, type SynthSfxSpec } from '@taalcut/core';
import { measureBs1770Loudness, normalisePcmToLufs } from '../mix/bs1770-loudnorm';

export interface SynthesizedSfx {
  readonly category: SynthSfxCategory;
  readonly sampleRate: number;
  readonly durationMs: number;
  /** The instant (ms from start) that should align on the cut or graphic cue. */
  readonly peakMs: number;
  readonly integratedLufs: number;
  readonly truePeakDbtp: number;
  readonly samples: Float32Array;
  readonly wav: Buffer;
}

/** Deterministic `mulberry32` PRNG returning `[-1, 1]`. */
function createNoiseRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

/** Time-varying Chamberlin state-variable filter (lowpass, bandpass, highpass). */
function svfFilterSweep(
  input: Float32Array,
  sampleRate: number,
  mode: 'lowpass' | 'bandpass' | 'highpass',
  freqAt: (u: number) => number,
  q = 1.4,
): Float32Array {
  const out = new Float32Array(input.length);
  const damp = 1 / Math.max(0.5, q);
  let low = 0;
  let band = 0;
  const invN = 1 / Math.max(1, input.length - 1);
  for (let i = 0; i < input.length; i++) {
    const fc = Math.max(30, Math.min(sampleRate * 0.42, freqAt(i * invN)));
    const f = 2 * Math.sin((Math.PI * fc) / sampleRate);
    const x = input[i] ?? 0;
    low += f * band;
    const high = x - low - damp * band;
    band += f * high;
    out[i] = mode === 'lowpass' ? low : mode === 'bandpass' ? band : high;
  }
  return out;
}

/** Encodes a mono 16-bit PCM RIFF WAV `Buffer` from normalized `[-1, 1]` float samples. */
export function encodePcm16Wav(samples: Float32Array, sampleRate = 48_000): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // Mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

/**
 * Synthesizes a procedural sound effect (`SynthSfxSpec`) in memory at `sampleRate` (default 48 kHz),
 * normalized to `spec.targetLufs` via ITU-R BS.1770-4.
 */
export function synthesizeProceduralSfx(
  rawSpec: z.input<typeof synthSfxSpecSchema>,
  sampleRate = 48_000,
): SynthesizedSfx {
  const spec: SynthSfxSpec = synthSfxSpecSchema.parse(rawSpec);
  const totalSamples = Math.max(64, Math.round((spec.durationMs * sampleRate) / 1000));
  const raw = new Float32Array(totalSamples);
  const rng = createNoiseRng(spec.seed);
  const bright = spec.brightness;
  let peakMs = Math.round(spec.durationMs * 0.5);

  switch (spec.category) {
    case 'whoosh': {
      peakMs = Math.round(spec.durationMs * 0.52);
      for (let i = 0; i < totalSamples; i++) {
        const u = i / totalSamples;
        const env = Math.exp(-(((u - 0.52) / 0.18) ** 2)) * Math.sin(Math.PI * u);
        raw[i] = rng() * env;
      }
      const fLow = 220 + bright * 400;
      const fHigh = 1800 + bright * 4200;
      const swept = svfFilterSweep(
        raw,
        sampleRate,
        'bandpass',
        (u) => fLow + (fHigh - fLow) * Math.sin(Math.PI * u),
        1.8,
      );
      raw.set(swept);
      break;
    }

    case 'riser': {
      peakMs = spec.durationMs;
      const f0 = spec.pitchHz ?? 140;
      const f1 = f0 * (4 + bright * 4);
      const bpmHz = spec.bpm ? spec.bpm / 60 : 0;
      let phase = 0;
      for (let i = 0; i < totalSamples; i++) {
        const u = i / totalSamples;
        const t = i / sampleRate;
        const freq = f0 * Math.pow(f1 / f0, u * u);
        phase += (2 * Math.PI * freq) / sampleRate;
        const env = Math.pow(u, 1.8) * Math.min(1, (1 - u) * 30);
        const trem = bpmHz > 0 ? 0.78 + 0.22 * Math.sin(2 * Math.PI * bpmHz * (2 + 6 * u) * t) : 1;
        const tone = 0.65 * Math.sin(phase) + 0.35 * Math.sin(phase * 2);
        raw[i] = (tone * 0.6 + rng() * 0.4) * env * trem;
      }
      const swept = svfFilterSweep(raw, sampleRate, 'highpass', (u) => 120 + u * u * (2400 + bright * 2800), 1.4);
      raw.set(swept);
      break;
    }

    case 'impact':
    case 'sub-drop': {
      peakMs = Math.min(25, Math.round(spec.durationMs * 0.08));
      const fStart = spec.pitchHz ?? (spec.category === 'sub-drop' ? 95 : 150);
      const fEnd = spec.category === 'sub-drop' ? 28 : 42;
      let phase = 0;
      for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        const freq = fEnd + (fStart - fEnd) * Math.exp(-t / 0.065);
        phase += (2 * Math.PI * freq) / sampleRate;
        const attack = Math.min(1, t / 0.004);
        const bodyEnv = Math.exp(-t / (spec.category === 'sub-drop' ? 0.65 : 0.32));
        const transientEnv = Math.exp(-t / 0.025);
        const noiseWeight = spec.category === 'sub-drop' ? 0.15 : 0.55;
        raw[i] = attack * (Math.sin(phase) * bodyEnv + rng() * transientEnv * noiseWeight);
      }
      const cutoff = spec.category === 'sub-drop' ? 600 + bright * 600 : 1800 + bright * 4000;
      const filtered = svfFilterSweep(raw, sampleRate, 'lowpass', () => cutoff, 1.1);
      raw.set(filtered);
      break;
    }

    case 'hit':
    case 'ui-click': {
      peakMs = spec.category === 'ui-click' ? 4 : 12;
      const baseFreq = spec.pitchHz ?? (spec.category === 'ui-click' ? 1850 : 620);
      let phase = 0;
      const decaySec = spec.category === 'ui-click' ? 0.018 : 0.065;
      for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        const freq = baseFreq * (1 + 0.6 * Math.exp(-t / 0.008));
        phase += (2 * Math.PI * freq) / sampleRate;
        const attack = Math.min(1, t / 0.001);
        const env = attack * Math.exp(-t / decaySec);
        raw[i] = (0.75 * Math.sin(phase) + 0.25 * rng()) * env;
      }
      break;
    }

    case 'synth-swell': {
      peakMs = Math.round(spec.durationMs * 0.62);
      const root = spec.pitchHz ?? 220;
      // Just-intonation lush fifth + octave + major tenth chord swell
      const ratios = [1, 1.498, 2, 2.52];
      for (let i = 0; i < totalSamples; i++) {
        const u = i / totalSamples;
        const t = i / sampleRate;
        const env = Math.sin(Math.PI * Math.pow(u, 0.85));
        let sum = 0;
        for (const r of ratios) {
          sum += Math.sin(2 * Math.PI * root * r * t + 0.15 * Math.sin(2 * Math.PI * 3.2 * t));
        }
        raw[i] = (sum / ratios.length) * env;
      }
      const swept = svfFilterSweep(
        raw,
        sampleRate,
        'lowpass',
        (u) => 350 + (1800 + bright * 3200) * Math.sin(Math.PI * u),
        1.5,
      );
      raw.set(swept);
      break;
    }
  }

  const samples = normalisePcmToLufs(raw, sampleRate, spec.targetLufs, -1.0);
  const measured = measureBs1770Loudness(samples, sampleRate);
  return {
    category: spec.category,
    sampleRate,
    durationMs: spec.durationMs,
    peakMs,
    integratedLufs: measured.integratedLufs,
    truePeakDbtp: measured.truePeakDbtp,
    samples,
    wav: encodePcm16Wav(samples, sampleRate),
  };
}

import type { z } from 'zod';
