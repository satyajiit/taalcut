// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Click-track F-measure when Beat This! and onnxruntime-node are both present.
 * Window stitching for a 3 minute piece does not need the weights.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { planWindows, stitchPredictions, type WindowPrediction } from '../../src/beats/aggregate';
import { AUDIO_CONFIG } from '../../src/config';
import { createOrtBeatRuntime } from '../../src/beats/ort';
import { createBeatTracker } from '../../src/beats/tracker';

const modelDir =
  process.env.TAALCUT_BEAT_THIS_DIR ?? fileURLToPath(new URL('../../.cache/beat-this/', import.meta.url));

async function live(): Promise<string> {
  for (const name of ['beat_this.onnx', 'mel-filterbank.bin']) {
    try {
      await access(join(modelDir, name));
    } catch {
      return `beats: skipped, ${name} is not in ${modelDir}`;
    }
  }
  const probe = await createOrtBeatRuntime().openSession(join(modelDir, 'missing-probe.onnx'), {
    operation: 'audio.trackBeats',
    candidates: ['webgpu', 'cpu'],
  });
  if (!probe.ok && probe.error.code === 'audio.model_missing') {
    return 'beats: skipped, onnxruntime-node is not installed';
  }
  return '';
}

/** 8 ms 880 Hz bursts, the same click as ffmpeg `aevalsrc` at this rate. */
function clicks(bpm: number, seconds: number, offsetSeconds = 0): { samples: Float32Array; times: number[] } {
  const rate = AUDIO_CONFIG.beats.sampleRate;
  const n = Math.round(rate * seconds);
  const samples = new Float32Array(n);
  const period = Math.round((rate * 60) / bpm);
  const click = Math.round(rate * 0.008);
  const times: number[] = [];
  const origin = Math.round(rate * offsetSeconds);
  for (let start = origin; start + click < n; start += period) {
    times.push(Math.round((start / rate) * 1000));
    for (let k = 0; k < click; k++) {
      const t = (start + k) / rate;
      samples[start + k] = Math.sin(2 * Math.PI * 880 * t);
    }
  }
  return { samples, times };
}

function fMeasure(truth: readonly number[], predicted: readonly number[], windowMs = 70): number {
  const used = new Set<number>();
  let hits = 0;
  for (const at of truth) {
    let best = -1;
    let bestDist = windowMs + 1;
    for (let i = 0; i < predicted.length; i++) {
      if (used.has(i)) continue;
      const dist = Math.abs((predicted[i] ?? 0) - at);
      if (dist <= windowMs && dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      hits += 1;
    }
  }
  const precision = predicted.length === 0 ? 0 : hits / predicted.length;
  const recall = truth.length === 0 ? 0 : hits / truth.length;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

describe('beat integration', () => {
  it('stitches a 3 minute frame grid', () => {
    const n = 3 * 60 * AUDIO_CONFIG.beats.fps;
    const windows = planWindows(n);
    const pieces: WindowPrediction[] = windows.map((window) => {
      const beat = new Float32Array(AUDIO_CONFIG.beats.windowFrames);
      for (let i = 0; i < beat.length; i++) {
        const frame = window.start + i;
        beat[i] = frame >= 0 && frame < n ? frame : -1000;
      }
      return { start: window.start, beat, downbeat: beat };
    });
    const stitched = stitchPredictions(n, pieces);
    expect(stitched.beat[0]).toBe(0);
    expect(stitched.beat[n - 1]).toBe(n - 1);
    expect(windows.length).toBeGreaterThan(2);
  });

  it('measures click F-measure at 60, 120 and 160 BPM when the model runs', async () => {
    const skip = await live();
    if (skip) {
      console.warn(skip);
      return;
    }
    const notes: string[] = [];
    const remember = (event: ComputeFallbackEvent): void => {
      notes.push(`${event.operation}:${event.reason}`);
    };
    const tracker = createBeatTracker({
      modelDir,
      onnx: createOrtBeatRuntime(remember),
      onFallback: remember,
    });
    // Spike 05: 20 s, first click at 0.5 s. The published F70 is the mean
    // across 60–160 (0.9734). 60 BPM alone was 0.8889, four tail clicks.
    const scored: number[] = [];
    for (const bpm of [60, 120, 160]) {
      const measured = await measure(tracker, bpm, 20, 0.5, notes);
      scored.push(measured.score);
      expect(measured.bpm).not.toBeNull();
      if (measured.bpm === null) return;
      expect(Math.abs(measured.bpm - bpm) / bpm).toBeLessThanOrEqual(0.01);
      // 60 BPM's own F70 in spike 05 was 0.8889. 120 and 160 clear 0.9.
      expect(measured.score).toBeGreaterThanOrEqual(bpm === 60 ? 0.88 : 0.9);
    }
    const mean = scored.reduce((sum, score) => sum + score, 0) / scored.length;
    console.warn(`beats mean F=${mean.toFixed(3)} over ${scored.map((score) => score.toFixed(3)).join(',')}`);
    expect(mean).toBeGreaterThanOrEqual(0.9);
    // 45 s is two windows. The exported graph's batch size is 1.
    const across = await measure(tracker, 120, 45, 0.5, notes);
    expect(across.score).toBeGreaterThanOrEqual(0.9);
    expect(across.bpm).not.toBeNull();
    if (across.bpm === null) return;
    expect(Math.abs(across.bpm - 120) / 120).toBeLessThanOrEqual(0.01);
    expect(notes.filter((note) => note.startsWith('audio.beatFrontEnd'))).toEqual([]);
  }, 180_000);
});

async function measure(
  tracker: ReturnType<typeof createBeatTracker>,
  bpm: number,
  seconds: number,
  offset: number,
  notes: readonly string[],
): Promise<{ score: number; bpm: number | null }> {
  const clip = clicks(bpm, seconds, offset);
  const started = Date.now();
  const result = await tracker.trackBeats(clip.samples);
  const wall = (Date.now() - started) / 1000;
  expect(result.ok).toBe(true);
  if (!result.ok) return { score: 0, bpm: null };
  const predicted = result.value.beatMap.beats.map((beat) => beat.value);
  const score = fMeasure(clip.times, predicted);
  const got = result.value.beatMap.bpm;
  const modelNote = notes.find((note) => note.startsWith('audio.trackBeats')) ?? 'audio.trackBeats:webgpu';
  console.warn(
    `beats ${bpm} BPM ${seconds}s F=${score.toFixed(3)} bpm=${got ?? 'null'} rtf=${(wall / seconds).toFixed(3)} beats=${predicted.length} ${modelNote}`,
  );
  return { score, bpm: got };
}
