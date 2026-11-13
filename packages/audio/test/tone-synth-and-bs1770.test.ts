// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, ok } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import {
  buildGrooveGrid,
  createRecommendDspChainTool,
  createSnapToGrooveTool,
  createSynthesizeSfxTool,
  measureBs1770Loudness,
  normalisePcmToLufs,
  snapTimeToGroove,
  solveStemLoudnorm,
  synthesizeProceduralSfx,
} from '../src';

describe('ITU-R BS.1770-4 loudness meter and stem normalizer (pyloudnorm equivalent)', () => {
  it('measures K-weighted integrated LUFS and true peak on a 1 kHz sine wave and normalizes to target LUFS', () => {
    const sampleRate = 48_000;
    const samples = new Float32Array(sampleRate * 2); // 2 seconds
    const amplitude = 0.1; // -20 dBFS peak
    for (let i = 0; i < samples.length; i++) {
      samples[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }

    const measured = measureBs1770Loudness(samples, sampleRate);
    // 1 kHz sine at -20 dBFS has RMS -23.01 dB and K-weighting ~ +0.03 dB -> ~ -23.7 LUFS
    expect(measured.integratedLufs).toBeGreaterThan(-24.5);
    expect(measured.integratedLufs).toBeLessThan(-22.5);
    expect(measured.truePeakDbtp).toBeCloseTo(-20, 0);

    const solved = solveStemLoudnorm(samples, sampleRate, 'dialogue');
    expect(solved.targetLufs).toBe(-16);
    expect(solved.recommendedGainDb).toBeGreaterThan(6.5);
    expect(solved.recommendedGainDb).toBeLessThan(8.5);

    const normalized = normalisePcmToLufs(samples, sampleRate, -16, -1.0);
    const remeasured = measureBs1770Loudness(normalized, sampleRate);
    expect(remeasured.integratedLufs).toBeCloseTo(-16, 0);
    expect(remeasured.truePeakDbtp).toBeLessThanOrEqual(-0.9);
  });
});

describe('Tone.js-style procedural SFX synthesizer (synthesizeProceduralSfx)', () => {
  it('records the missing accelerated synthesis kernel once before producing local WAV artifacts', async () => {
    const onComputeFallback = vi.fn();
    const tool = createSynthesizeSfxTool({ onComputeFallback });
    const input = tool.input.parse({ category: 'ui-click', durationMs: 40 });
    const put = vi.fn(async () =>
      ok({ id: newId<'Artifact'>(), mediaType: 'audio/wav', bytes: 3884, summary: 'Click' }),
    );
    const context = { artifacts: { put } } as never;
    expect((await tool.run(input, context)).ok).toBe(true);
    expect((await tool.run(input, context)).ok).toBe(true);
    expect(put).toHaveBeenCalledTimes(2);
    expect(onComputeFallback).toHaveBeenCalledExactlyOnceWith({
      operation: 'audio.synthesizeProceduralSfx',
      wanted: ['metal', 'webgpu', 'cuda'],
      reason: 'no_accelerator',
      detail: expect.stringContaining('no accelerated kernel'),
    });
    expect(onComputeFallback.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0]!);
  });

  it('synthesizes deterministic BPM-locked risers, whooshes, impacts, and synth-swells as valid WAVs', () => {
    const riser = synthesizeProceduralSfx({
      category: 'riser',
      durationMs: 600,
      bpm: 128,
      pitchHz: 180,
      targetLufs: -16,
      seed: 42,
    });
    expect(riser.peakMs).toBe(600);
    expect(riser.wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    // This transient hits the reconstructed peak ceiling, so headroom takes precedence over target LUFS.
    expect(riser.integratedLufs).toBeLessThanOrEqual(-16);
    expect(riser.truePeakDbtp).toBeCloseTo(-1, 2);

    // Determinism check: identical seed produces byte-identical WAV
    const riserAgain = synthesizeProceduralSfx({
      category: 'riser',
      durationMs: 600,
      bpm: 128,
      pitchHz: 180,
      targetLufs: -16,
      seed: 42,
    });
    expect(Buffer.compare(riser.wav, riserAgain.wav)).toBe(0);

    const swell = synthesizeProceduralSfx({
      category: 'synth-swell',
      durationMs: 500,
      pitchHz: 220,
      targetLufs: -18,
    });
    expect(swell.integratedLufs).toBeCloseTo(-18, 0);
  });
});

describe('musical groove subdivision grid and snap (buildGrooveGrid, snapTimeToGroove)', () => {
  it.each([
    ['none', 0],
    ['voice-clarity', 6],
    ['voice-warm', 5],
    ['music-carve', 2],
    ['underwater-transition', 3],
    ['lofi-intro', 3],
  ] as const)('recommends %s with each preset effect applied once', async (preset, count) => {
    const tool = createRecommendDspChainTool();
    const result = await tool.run({ role: 'dialogue', preset }, {} as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.preset).toBe(preset);
    expect(result.value.chain).toEqual({ preset, nodes: [] });
    expect(result.value.ffmpegFilter.split(',').filter(Boolean)).toHaveLength(count);
  });

  it('subdivides beats into 1/4 sixteenth notes with swing and snaps cuts toward strong accents', () => {
    const grid = { beatsMs: [0, 500, 1000, 1500], downbeats: [0] };
    const groove = buildGrooveGrid(grid, '1/4', 0.58);
    // 3 intervals * 4 steps + final beat = 13 points
    expect(groove.points).toHaveLength(13);
    expect(groove.points[0]?.kind).toBe('downbeat');
    expect(groove.points[1]?.kind).toBe('subbeat');
    // Swing > 0.5 pushes first 16th past 125 ms
    expect(groove.points[1]!.ms).toBeGreaterThan(125);

    const snapped = snapTimeToGroove(492, groove, 60);
    expect(snapped.snapped).toBe(true);
    expect(snapped.snappedMs).toBe(500);
    expect(snapped.point?.kind).toBe('beat');
  });

  it('runs recommendDspChain and snapToGroove agent tools', async () => {
    const dspTool = createRecommendDspChainTool();
    const dspRes = await dspTool.run(
      { role: 'dialogue', integratedLufs: -22, truePeakDbtp: -8 },
      {} as never,
    );
    expect(dspRes.ok).toBe(true);
    if (dspRes.ok) {
      expect(dspRes.value.preset).toBe('voice-clarity');
      expect(dspRes.value.ffmpegFilter).toContain('acompressor=');
      expect(dspRes.value.recommendedGainDb).toBeCloseTo(6);
    }

    const grooveTool = createSnapToGrooveTool();
    const grooveRes = await grooveTool.run(
      {
        timesMs: [488, 1015],
        beatsMs: [0, 500, 1000, 1500],
        downbeats: [0],
        subdivision: '1/2',
        swing: 0.5,
        maxWindowMs: 50,
      },
      {} as never,
    );
    expect(grooveRes.ok).toBe(true);
    if (grooveRes.ok) {
      expect(grooveRes.value.snappedCount).toBe(2);
      expect(grooveRes.value.results[0]?.snappedMs).toBe(500);
    }
  });
});
