// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where Beat This! runs (LNX1): the platform's row less what the probe says the machine can't run, CUDA on the
 * probe's device, the CPU alone with its reason (`disabled` when forced). The tracker opens the model and the
 * front end on the plan; a forced CPU is `disabled` on the bus, for both.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type ComputeFallbackEvent } from '@taalcut/core';
import { encodeOnnxModel, type MachineAccelerators } from '@taalcut/media';
import { afterAll, describe, expect, it } from 'vitest';
import { AUDIO_CONFIG } from '../../src/config';
import { beatDevicePlan } from '../../src/beats/devices';
import { runLogMel } from '../../src/beats/mel-onnx';
import { createOrtBeatRuntime } from '../../src/beats/ort';
import { createBeatTracker } from '../../src/beats/tracker';
import type { BeatDevice, BeatOnnxRuntime } from '../../src/beats/types';

const { nFreq, nMels, sampleRate, windowFrames } = AUDIO_CONFIG.beats;
const linux = (
  apis: MachineAccelerators['apis'],
  extra: Partial<MachineAccelerators> = {},
): MachineAccelerators => ({
  platform: 'linux',
  apis,
  forcedCpu: false,
  ...extra,
});
const FORCED = beatDevicePlan('linux', linux([], { forcedCpu: true }));

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('beatDevicePlan', () => {
  it('has a row per platform, Windows included, and keeps it without a probe', () => {
    expect(beatDevicePlan('darwin').devices).toEqual(['webgpu', 'cpu']);
    expect(beatDevicePlan('win32').devices).toEqual(['cuda', 'directml', 'webgpu', 'cpu']);
    expect(beatDevicePlan('linux')).toEqual({ devices: ['cuda', 'webgpu', 'cpu'] });
  });

  it("takes CUDA on the probe's device, and WebGPU where CUDA 13 doesn't run", () => {
    expect(beatDevicePlan('linux', linux(['cuda', 'vulkan'], { cudaDeviceId: 1 }))).toEqual({
      devices: ['cuda', 'webgpu', 'cpu'],
      cudaDeviceId: 1,
    });
    expect(beatDevicePlan('linux', linux(['vulkan'], { cudaDeviceId: 0 }))).toEqual({
      devices: ['webgpu', 'cpu'],
    });
  });

  it('says why the CPU alone: disabled when forced, no accelerator without a GPU API', () => {
    expect(FORCED).toEqual({
      devices: ['cpu'],
      cpuReason: {
        reason: 'disabled',
        detail: 'TAALCUT_FORCE_CPU turned the GPUs off',
        wanted: ['cuda', 'webgpu'],
      },
    });
    expect(beatDevicePlan('linux', linux([])).cpuReason).toMatchObject({ reason: 'no_accelerator' });
  });
});

describe('the tracker on the plan', () => {
  it("opens the model on the plan's devices", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-beat-plan-'));
    dirs.push(dir);
    await writeFile(join(dir, 'beat_this.onnx'), Buffer.alloc(0));
    await writeFile(join(dir, 'mel-filterbank.bin'), Buffer.alloc(nFreq * nMels * 4));
    const asked: (readonly BeatDevice[])[] = [];
    const onnx: BeatOnnxRuntime = {
      plan: async () => FORCED,
      async openSession(_path, options) {
        asked.push(options.candidates);
        return ok({
          backend: 'cpu',
          run: async (input) =>
            ok({
              beat: new Float32Array(input.dims[0] * windowFrames),
              downbeat: new Float32Array(input.dims[0] * windowFrames),
            }),
        });
      },
    };
    const events: ComputeFallbackEvent[] = [];
    const result = await createBeatTracker({
      modelDir: dir,
      onnx,
      onFallback: (e) => events.push(e),
    }).trackBeats(new Float32Array(sampleRate / 10));
    expect(result.ok).toBe(true);
    expect(asked).toEqual([['cpu']]);
    // The front end ran on the CPU too, recorded as `disabled`.
    expect(events.map((e) => [e.operation, e.reason])).toEqual([['audio.beatFrontEnd', 'disabled']]);
  }, 30_000);

  it('records a forced CPU session as disabled on the real runtime', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-beat-forced-'));
    dirs.push(dir);
    const model = join(dir, 'relu.onnx');
    await writeFile(
      model,
      encodeOnnxModel({
        inputs: [{ name: 'X', dims: [1, 4] }],
        outputs: [{ name: 'Y', dims: [1, 4] }],
        nodes: [{ op: 'Relu', inputs: ['X'], outputs: ['Y'] }],
      }),
    );
    const events: ComputeFallbackEvent[] = [];
    const runtime = createOrtBeatRuntime(
      (event) => events.push(event),
      async () => FORCED,
    );
    const session = await runtime.openSession(model, { operation: 'audio.trackBeats', candidates: ['cpu'] });
    expect(session.ok && session.value.backend).toBe('cpu');
    expect(events).toMatchObject([
      { operation: 'audio.trackBeats', reason: 'disabled', wanted: ['cuda', 'webgpu'] },
    ]);
    if (session.ok) await session.value.release?.();

    const front: ComputeFallbackEvent[] = [];
    const mel = await runLogMel(
      new Float32Array(2048),
      new Float32Array(nFreq * nMels),
      (e) => front.push(e),
      FORCED,
    );
    expect(mel.frames).toBeGreaterThan(0);
    expect(front.map((e) => [e.operation, e.reason])).toEqual([['audio.beatFrontEnd', 'disabled']]);
  }, 30_000);
});
