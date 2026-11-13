// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Compiles Pedalboard-style declarative `AudioEffectChain` / `AudioDspPresetId` definitions into deterministic
 * LGPL FFmpeg audio filter chains (`highpass`, `lowpass`, `equalizer`, `acompressor`, `agate`, `alimiter`, `aecho`).
 */
import type { AudioDspNode, AudioDspPresetId, AudioEffectChain } from '@taalcut/core';

/** Built-in studio DSP node chains for each named `AudioDspPresetId`. */
export function presetDspNodes(preset: AudioDspPresetId): readonly AudioDspNode[] {
  switch (preset) {
    case 'none':
      return [];
    case 'voice-clarity':
      return [
        { kind: 'highpass', frequencyHz: 85, poles: 2 },
        { kind: 'gate', thresholdDb: -42, ratio: 2.5, attackMs: 10, releaseMs: 150 },
        { kind: 'equalizer', frequencyHz: 240, q: 1.4, gainDb: -2.0 },
        { kind: 'equalizer', frequencyHz: 3200, q: 1.2, gainDb: 2.5 },
        { kind: 'compressor', thresholdDb: -18, ratio: 3, attackMs: 15, releaseMs: 120, makeupDb: 2.5 },
        { kind: 'limiter', limitDb: -1.5, attackMs: 5, releaseMs: 50 },
      ];
    case 'voice-warm':
      return [
        { kind: 'highpass', frequencyHz: 70, poles: 2 },
        { kind: 'equalizer', frequencyHz: 180, q: 1.1, gainDb: 1.8 },
        { kind: 'equalizer', frequencyHz: 2800, q: 1.2, gainDb: 1.5 },
        { kind: 'compressor', thresholdDb: -20, ratio: 2.8, attackMs: 20, releaseMs: 140, makeupDb: 2.0 },
        { kind: 'limiter', limitDb: -1.5, attackMs: 5, releaseMs: 50 },
      ];
    case 'music-carve':
      return [
        { kind: 'highpass', frequencyHz: 35, poles: 2 },
        // Carve 1.5 kHz–2.8 kHz presence band so speech consonants sit cleanly on top of music.
        { kind: 'equalizer', frequencyHz: 2000, q: 1.0, gainDb: -3.5 },
      ];
    case 'underwater-transition':
      return [
        { kind: 'lowpass', frequencyHz: 480, poles: 2 },
        { kind: 'equalizer', frequencyHz: 380, q: 2.2, gainDb: 3.0 },
        { kind: 'reverb', roomMix: 0.25, delayMs: 55, decay: 0.35 },
      ];
    case 'lofi-intro':
      return [
        { kind: 'highpass', frequencyHz: 320, poles: 2 },
        { kind: 'lowpass', frequencyHz: 3400, poles: 2 },
        { kind: 'compressor', thresholdDb: -16, ratio: 4, attackMs: 8, releaseMs: 90, makeupDb: 1.5 },
      ];
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Converts a single `AudioDspNode` into its FFmpeg filter string. */
export function dspNodeToFilter(node: AudioDspNode): string {
  switch (node.kind) {
    case 'highpass':
      return `highpass=f=${r2(node.frequencyHz)}:p=${node.poles}`;
    case 'lowpass':
      return `lowpass=f=${r2(node.frequencyHz)}:p=${node.poles}`;
    case 'equalizer':
      return `equalizer=f=${r2(node.frequencyHz)}:width_type=q:w=${r2(node.q)}:g=${r2(node.gainDb)}`;
    case 'compressor':
      return (
        `acompressor=threshold=${r2(node.thresholdDb)}dB:ratio=${r2(node.ratio)}:` +
        `attack=${r2(node.attackMs)}:release=${r2(node.releaseMs)}:makeup=${r2(node.makeupDb)}dB`
      );
    case 'gate':
      return (
        `agate=threshold=${r2(node.thresholdDb)}dB:ratio=${r2(node.ratio)}:` +
        `attack=${r2(node.attackMs)}:release=${r2(node.releaseMs)}`
      );
    case 'limiter':
      return `alimiter=limit=${r2(node.limitDb)}dB:attack=${r2(node.attackMs)}:release=${r2(node.releaseMs)}:level=false`;
    case 'reverb': {
      const inGain = r2(Math.max(0.4, 1 - node.roomMix * 0.4));
      const outGain = r2(Math.max(0.5, 1 - node.roomMix * 0.2));
      return `aecho=${inGain}:${outGain}:${node.delayMs}:${r2(node.decay)}`;
    }
  }
}

/**
 * Resolves an `AudioEffectChain` or `AudioDspPresetId` into an ordered list of FFmpeg filter steps.
 * Custom `chain.nodes` are appended after the preset's nodes (or replace `'none'`).
 */
export function buildDspFilterSteps(chain: AudioEffectChain | AudioDspPresetId): string[] {
  if (typeof chain === 'string') {
    return presetDspNodes(chain).map(dspNodeToFilter);
  }
  const base = presetDspNodes(chain.preset);
  return [...base, ...chain.nodes].map(dspNodeToFilter);
}

/** Joins the resolved FFmpeg audio filters with commas, or returns `''` when the chain is empty. */
export function buildDspFilterChain(chain: AudioEffectChain | AudioDspPresetId): string {
  return buildDspFilterSteps(chain).join(',');
}
