// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The graph and the oracle agree. They do not share pad or onset code. */
import { describe, expect, it } from 'vitest';
import { AUDIO_CONFIG } from '../../src/config';
import { onsetStrength, referenceLogMel } from '../../src/beats/frontend';
import { beatFrontEndGraph } from '../../src/beats/graph';

const { nFreq, nMels, sampleRate } = AUDIO_CONFIG.beats;

function filterbank(): Float32Array {
  const bank = new Float32Array(nFreq * nMels);
  for (let k = 0; k < nFreq; k++) {
    for (let m = 0; m < nMels; m++) bank[k * nMels + m] = ((k * 17 + m * 3) % 97) / 10_000;
  }
  return bank;
}

function sine(seconds: number): Float32Array {
  const n = Math.round(sampleRate * seconds);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
  return samples;
}

function maxAbs(left: Float32Array, right: Float32Array): number {
  expect(left.length).toBe(right.length);
  let max = 0;
  for (let i = 0; i < left.length; i++) max = Math.max(max, Math.abs((left[i] ?? 0) - (right[i] ?? 0)));
  return max;
}

describe('beat front end', () => {
  const bank = filterbank();

  it('matches the oracle within 1e-4 on a tone and on empty audio', () => {
    for (const samples of [sine(0.2), new Float32Array(0)]) {
      const oracle = referenceLogMel(samples, bank);
      const graph = beatFrontEndGraph(bank).run(samples);
      const onset = onsetStrength(oracle, graph.frames, nMels);
      expect(maxAbs(graph.logMel, oracle)).toBeLessThanOrEqual(1e-4);
      expect(maxAbs(graph.onset, onset)).toBeLessThanOrEqual(1e-4);
      expect(graph.frames).toBe(1 + Math.floor(samples.length / AUDIO_CONFIG.beats.hop));
    }
  });
});
