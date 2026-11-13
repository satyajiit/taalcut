// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Vision's ONNX sessions on the caller's devices, kept to those onnxruntime lists (IX-O7), with a fake module. */
import type { ComputeFallbackEvent } from '@taalcut/core';
import type { OnnxDeviceFailure } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { createOrtRuntime, type OrtModule } from '../../src/onnx/ort';

function fakeOrt(
  listed: readonly string[] | null,
  failing: readonly string[] = [],
  message = 'cannot create',
) {
  const providers: string[][] = [];
  class Tensor {
    constructor(
      readonly type: 'float32',
      readonly data: Float32Array,
      readonly dims: readonly number[],
    ) {}
  }
  const module: OrtModule = {
    Tensor,
    InferenceSession: {
      async create(_path, options) {
        const names = options.executionProviders.map((p) => (typeof p === 'string' ? p : p.name));
        providers.push(names);
        if (names.some((name) => failing.includes(name))) throw new Error(message);
        return { inputNames: ['x'], outputNames: ['y'], run: async () => ({}), release: async () => {} };
      },
    },
    ...(listed ? { listSupportedBackends: () => listed.map((name) => ({ name })) } : {}),
  };
  return { module, providers };
}

async function open(ort: OrtModule, options: Parameters<typeof createOrtRuntime>[0] = {}) {
  const events: ComputeFallbackEvent[] = [];
  const runtime = createOrtRuntime({ load: async () => ort, onFallback: (e) => events.push(e), ...options });
  const session = await runtime.openSession('model.onnx', { operation: 'vision.ocr' });
  return { backend: session.ok ? session.value.backend : session.error.code, events };
}

describe('createOrtRuntime devices', () => {
  it('opens WebGPU by default', async () => {
    const { module, providers } = fakeOrt(['cpu', 'webgpu']);
    expect((await open(module)).backend).toBe('webgpu');
    expect(providers).toEqual([['webgpu']]);
  });

  it("takes the caller's first listed device: DirectML on a Windows build without CUDA", async () => {
    const { module, providers } = fakeOrt(['cpu', 'webgpu', 'dml']);
    const opened = await open(module, { devices: ['cuda', 'directml', 'webgpu', 'cpu'] });
    expect(opened).toEqual({ backend: 'directml', events: [] });
    expect(providers).toEqual([['dml']]);
  });

  it('tries the next listed device when one fails, then the CPU with accelerator_failed', async () => {
    const { module, providers } = fakeOrt(['cpu', 'webgpu', 'dml'], ['dml', 'webgpu']);
    const opened = await open(module, { devices: ['directml', 'webgpu', 'cpu'] });
    expect(opened.backend).toBe('cpu');
    expect(providers).toEqual([['dml'], ['webgpu'], ['cpu']]);
    expect(opened.events.map((e) => e.reason)).toEqual(['accelerator_failed']);
  });

  it('says why the CPU when no wanted device is listed, or acceleration is off', async () => {
    const { module } = fakeOrt(['cpu']);
    const none = await open(module, { devices: ['directml', 'webgpu', 'cpu'] });
    expect(none.backend).toBe('cpu');
    expect(none.events).toMatchObject([
      { reason: 'no_accelerator', detail: 'no listed execution provider among directml, webgpu' },
    ]);
    const off = await open(fakeOrt(['cpu', 'webgpu']).module, { disableGpu: true });
    expect(off.events.map((e) => e.reason)).toEqual(['disabled']);
  });

  it('tries every wanted device when the module cannot list them', async () => {
    const { module, providers } = fakeOrt(null, ['cuda']);
    expect((await open(module, { devices: ['cuda', 'webgpu', 'cpu'] })).backend).toBe('webgpu');
    expect(providers).toEqual([['cuda'], ['webgpu']]);
  });

  it('names a cuda-runtime-13 installed since this process started, and opens the next device', async () => {
    const noProvider = 'OrtSessionOptionsAppendExecutionProvider_Cuda: Failed to load shared library';
    const { module } = fakeOrt(['cpu', 'webgpu', 'cuda'], ['cuda'], noProvider);
    const lib = '/components/installed/cuda-runtime-13/13.4.3-837da78cbfae/lib';
    const failures: OnnxDeviceFailure[] = [];
    const opened = await open(module, {
      devices: ['cuda', 'webgpu', 'cpu'],
      onDeviceFailed: (failure) => failures.push(failure),
      cudaLibraries: {
        libraryPath: '',
        exists: (path) => path.startsWith(lib) || path.endsWith('libcuda.so.1'),
        installedRuntime: () => lib,
      },
    });
    expect(opened).toEqual({ backend: 'webgpu', events: [] });
    expect(failures).toMatchObject([{ backend: 'cuda', reason: 'accelerator_failed', next: 'webgpu' }]);
    expect(failures[0]?.detail).toMatch(/installed after this process started: CUDA from its next start\)$/);
  });
});
