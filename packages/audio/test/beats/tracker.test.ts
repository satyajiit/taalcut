// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Tracker wiring with a fake session. The ONNX file is empty; nothing is loaded. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import { AUDIO_CONFIG } from '../../src/config';
import { createBeatTracker } from '../../src/beats/tracker';
import type { BeatOnnxRuntime, BeatSpectInput } from '../../src/beats/types';

const { nFreq, nMels, sampleRate, windowFrames } = AUDIO_CONFIG.beats;

function gridRuntime(): BeatOnnxRuntime {
  return {
    async openSession() {
      return ok({
        backend: 'webgpu' as const,
        async run(input: BeatSpectInput) {
          const frames = 1 + Math.floor(sampleRate / AUDIO_CONFIG.beats.hop);
          const beat = new Float32Array(input.dims[0] * windowFrames);
          const downbeat = new Float32Array(beat.length);
          for (let frame = 0; frame < frames; frame += 25) {
            beat[frame] = 5;
            if (frame % 100 === 0) downbeat[frame] = 5;
          }
          return ok({ beat, downbeat });
        },
      });
    },
  };
}

describe('createBeatTracker', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('returns an empty map for empty audio and does not open a session', async () => {
    let opened = false;
    const tracker = createBeatTracker({
      modelDir: '/tmp/taalcut-no-such-beats',
      onnx: {
        async openSession() {
          opened = true;
          return ok({
            backend: 'cpu',
            async run() {
              return ok({ beat: new Float32Array(), downbeat: new Float32Array() });
            },
          });
        },
      },
    });
    const result = await tracker.trackBeats(new Float32Array(0));
    expect(opened).toBe(false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.beatMap.beats).toEqual([]);
    expect(result.value.beatMap.bpm).toBeNull();
    expect(result.value.model).toBe(AUDIO_CONFIG.beats.model);
  });

  it('reports the beat model missing before it runs the front end', async () => {
    const tracker = createBeatTracker({
      modelDir: '/tmp/taalcut-no-such-beats',
      onnx: gridRuntime(),
    });
    const result = await tracker.trackBeats(new Float32Array(32));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('audio.model_missing');
  });

  it('turns a 120 BPM logit grid into millisecond beats', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-beat-grid-'));
    dirs.push(dir);
    await writeFile(join(dir, 'beat_this.onnx'), Buffer.alloc(0));
    await writeFile(join(dir, 'mel-filterbank.bin'), Buffer.alloc(nFreq * nMels * 4));
    const events: string[] = [];
    const tracker = createBeatTracker({
      modelDir: dir,
      onnx: gridRuntime(),
      onFallback: (event) => events.push(event.operation),
    });
    const result = await tracker.trackBeats(new Float32Array(sampleRate));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const times = result.value.beatMap.beats.map((beat) => beat.value);
    expect(times).toEqual([0, 500, 1000]);
    expect(result.value.beatMap.bpm).toBeCloseTo(120, 5);
    expect(result.value.beatMap.downbeats).toEqual([0]);
    expect(result.value.downbeatSource).toBe('model');
    expect(events).not.toContain('audio.beatFrontEnd');
  }, 30_000);
});
