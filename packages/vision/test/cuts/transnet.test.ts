// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-C2: TransNetV2 through vision's ONNX runtime, with a fake runtime: the window goes in as
 * [1, 100, 27, 48, 3], the two heads come back in graph order, a missing component or a bad graph is
 * `vision.shot_model_failed`, cancellation stays cancellation, and the session opens once.
 */
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { shotModelDevices, shotModelOnCoreMl, shotModelRuntime } from '../../src/cuts/backends';
import { TRANSNET_FILE, transNetLoader } from '../../src/cuts/transnet';
import type { OnnxRuntime, OnnxSession, OnnxTensor } from '../../src/onnx/ort';
import { OcrFailed } from '../../src/errors';

function fakeRuntime(options: { outputs?: string[]; length?: number; failRun?: 'cancel' | 'fail' } = {}) {
  const opened: string[] = [];
  const feeds: Record<string, OnnxTensor>[] = [];
  const runtime: OnnxRuntime = {
    openSession(modelPath) {
      opened.push(modelPath);
      const outputs = options.outputs ?? ['534', '535'];
      const session: OnnxSession = {
        backend: 'webgpu',
        inputNames: ['input'],
        outputNames: outputs,
        run(feed): AsyncResult<Record<string, OnnxTensor>> {
          feeds.push(feed);
          if (options.failRun === 'cancel') return Promise.resolve(err(CancelledError()));
          if (options.failRun === 'fail')
            return Promise.resolve(err(OcrFailed(undefined, { detail: 'gpu lost' })));
          const n = options.length ?? 100;
          return Promise.resolve(
            ok(
              Object.fromEntries(
                outputs.map((name, i) => [name, { data: new Float32Array(n).fill(i + 1), dims: [1, n, 1] }]),
              ),
            ),
          );
        },
        release: () => Promise.resolve(),
      };
      return Promise.resolve(ok(session));
    },
  };
  return { runtime, opened, feeds };
}

const window = new Float32Array(100 * 27 * 48 * 3);

describe('transNetLoader', () => {
  it('opens the component’s file once and reads the heads in graph order', async () => {
    const fake = fakeRuntime();
    const load = transNetLoader(fake.runtime, () => Promise.resolve('/models/transnetv2'));
    const model = await load();
    const again = await load();
    if (!model.ok || !again.ok) throw new Error('not loaded');
    expect(again.value).toBe(model.value);
    expect(fake.opened).toEqual([`/models/transnetv2/${TRANSNET_FILE}`]);
    expect(model.value.backend).toBe('webgpu');
    const out = await model.value.predict(window);
    if (!out.ok) throw new Error(out.error.code);
    expect(out.value.single[0]).toBe(1);
    expect(out.value.manyHot[0]).toBe(2);
    expect(fake.feeds[0]?.['input']?.dims).toEqual([1, 100, 27, 48, 3]);
  });

  it('says the component is missing, and tries again next time', async () => {
    const fake = fakeRuntime();
    let installed: string | null = null;
    const load = transNetLoader(fake.runtime, () => Promise.resolve(installed));
    const missing = await load();
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('vision.shot_model_failed');
    installed = '/models/transnetv2';
    expect((await load()).ok).toBe(true);
  });

  it('refuses a graph without two heads of 100 frames, and passes cancellation through', async () => {
    const one = await transNetLoader(fakeRuntime({ outputs: ['x'] }).runtime, () => Promise.resolve('/m'))();
    expect(one.ok).toBe(false);
    const short = await transNetLoader(fakeRuntime({ length: 50 }).runtime, () => Promise.resolve('/m'))();
    if (!short.ok) throw new Error('not loaded');
    const bad = await short.value.predict(window);
    expect(!bad.ok && bad.error.code).toBe('vision.shot_model_failed');
    const cancelled = await transNetLoader(fakeRuntime({ failRun: 'cancel' }).runtime, () =>
      Promise.resolve('/m'),
    )();
    if (!cancelled.ok) throw new Error('not loaded');
    const out = await cancelled.value.predict(window);
    expect(!out.ok && out.error.code).toBe('core.cancelled');
    const failed = await transNetLoader(fakeRuntime({ failRun: 'fail' }).runtime, () =>
      Promise.resolve('/m'),
    )();
    if (!failed.ok) throw new Error('not loaded');
    const lost = await failed.value.predict(window);
    expect(!lost.ok && lost.error.code).toBe('vision.shot_model_failed');
    const controller = new AbortController();
    controller.abort();
    const early = await failed.value.predict(window, controller.signal);
    expect(!early.ok && early.error.code).toBe('core.cancelled');
  });
});

describe('shotModelDevices', () => {
  it('runs on WebGPU then the CPU on a Mac (measured), and has an order everywhere', () => {
    expect(shotModelDevices('darwin')).toEqual(['webgpu', 'cpu']);
    expect(shotModelDevices('win32')).toEqual(['cuda', 'directml', 'webgpu', 'cpu']);
    expect(shotModelDevices('linux')).toEqual(['cuda', 'webgpu', 'cpu']);
    expect(shotModelDevices('freebsd')).toEqual(['cpu']);
  });

  it('tries the Core ML model in the mac helper first on a Mac only', () => {
    expect(['darwin', 'linux', 'win32'].map(shotModelOnCoreMl)).toEqual([true, false, false]);
  });

  it("keeps the rows the probe's accelerators can run, CUDA on the probe's device", () => {
    const linux = { platform: 'linux', forcedCpu: false } as const;
    expect(shotModelRuntime('linux', { ...linux, apis: ['cuda', 'vulkan'], cudaDeviceId: 1 })).toEqual({
      devices: ['cuda', 'webgpu', 'cpu'],
      cudaDeviceId: 1,
    });
    // No NVIDIA (or a driver below CUDA 13): WebGPU over Vulkan, and no device id.
    expect(shotModelRuntime('linux', { ...linux, apis: ['vulkan'], cudaDeviceId: 0 })).toEqual({
      devices: ['webgpu', 'cpu'],
    });
    expect(shotModelRuntime('linux', { ...linux, apis: [], forcedCpu: true })).toEqual({
      devices: ['cpu'],
      disableGpu: true,
    });
    expect(shotModelRuntime('linux')).toEqual({ devices: ['cuda', 'webgpu', 'cpu'] });
  });
});
