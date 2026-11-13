// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CUDA sessions and the machine's accelerators (LNX1), with a fake runtime: the probe's device id goes to the CUDA
 * provider, a CUDA failure names the libraries the loader can't find and the next device opens, every failure is in
 * the CPU fallback's detail, and the planners' rows follow the probe.
 */
import type { ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  canRun,
  cpuReasonFor,
  createOnnxRuntime,
  cudaFailureDetail,
  missingCudaLibraries,
  usableDevices,
  type MachineAccelerators,
  type OnnxDeviceFailure,
  type OnnxProviderConfig,
} from '@taalcut/media';

const NO_PROVIDER = 'OrtSessionOptionsAppendExecutionProvider_Cuda: Failed to load shared library';

function module(fail: Readonly<Record<string, string>> = {}) {
  const providers: OnnxProviderConfig[][] = [];
  return {
    providers,
    InferenceSession: {
      async create(
        _model: Uint8Array | string,
        options?: { readonly executionProviders?: readonly OnnxProviderConfig[] },
      ) {
        const chosen = [...(options?.executionProviders ?? [])];
        providers.push(chosen);
        const name = (p: OnnxProviderConfig) => (typeof p === 'string' ? p : p.name);
        const failing = chosen.map(name).find((n) => fail[n] !== undefined);
        if (failing) throw new Error(fail[failing]);
        return {
          async run() {
            return {};
          },
          release() {},
        };
      },
    },
  };
}

/** Only the cuda-runtime-13 folder holds the CUDA libraries; libcuda is the driver's. */
const runtimeOnPath = (dir: string) => (path: string) =>
  path === '/usr/lib/x86_64-linux-gnu/libcuda.so.1' || path.startsWith(`${dir}/`);

describe('CUDA sessions', () => {
  it("passes the probe's device id to the CUDA provider and nothing else", async () => {
    const runtime = module();
    const session = await createOnnxRuntime({
      loadModule: async () => runtime,
      cuda: { deviceId: 1 },
    }).openSession('model.onnx', { operation: 'vision.ocr', candidates: ['cuda', 'webgpu', 'cpu'] });
    expect(session.ok && session.value.backend).toBe('cuda');
    expect(runtime.providers).toEqual([[{ name: 'cuda', deviceId: 1 }]]);
  });

  it('names CUDA by name alone when the probe gave no device id', async () => {
    const runtime = module();
    await createOnnxRuntime({ loadModule: async () => runtime }).openSession('model.onnx', {
      operation: 'vision.ocr',
      candidates: ['cuda', 'cpu'],
    });
    expect(runtime.providers).toEqual([['cuda']]);
  });

  it('moves to WebGPU when the CUDA provider does not load, naming the missing libraries', async () => {
    const runtime = module({ cuda: NO_PROVIDER });
    const failed: OnnxDeviceFailure[] = [];
    const events: ComputeFallbackEvent[] = [];
    const session = await createOnnxRuntime({
      loadModule: async () => runtime,
      onDeviceFailed: (failure) => failed.push(failure),
      onComputeFallback: (event) => events.push(event),
      libraries: { libraryPath: '', exists: (path) => path === '/usr/lib/x86_64-linux-gnu/libcuda.so.1' },
    }).openSession('model.onnx', { operation: 'vision.ocr', candidates: ['cuda', 'webgpu', 'cpu'] });
    expect(session.ok && session.value.backend).toBe('webgpu');
    expect(events).toEqual([]);
    expect(failed).toEqual([
      {
        operation: 'vision.ocr',
        backend: 'cuda',
        reason: 'accelerator_failed',
        detail:
          `${NO_PROVIDER}: libcudart.so.13, libcublas.so.13, libcublasLt.so.13, libcurand.so.10 not found ` +
          '(cuda-runtime-13 is not on LD_LIBRARY_PATH)',
        next: 'webgpu',
      },
    ]);
  });

  it('comes to the CPU with every device in the detail when all fail', async () => {
    const runtime = module({ cuda: NO_PROVIDER, webgpu: 'no adapter' });
    const events: ComputeFallbackEvent[] = [];
    const session = await createOnnxRuntime({
      loadModule: async () => runtime,
      onDeviceFailed: () => {},
      onComputeFallback: (event) => events.push(event),
      libraries: { libraryPath: '/opt/cuda13/lib', exists: runtimeOnPath('/opt/cuda13/lib') },
    }).openSession('model.onnx', { operation: 'vision.embed', candidates: ['cuda', 'webgpu', 'cpu'] });
    expect(session.ok && session.value.backend).toBe('cpu');
    // The libraries are all there, so the provider's own message is kept as it is.
    expect(events).toEqual([
      {
        operation: 'vision.embed',
        wanted: ['cuda', 'webgpu'],
        reason: 'accelerator_failed',
        detail: `cuda: ${NO_PROVIDER}; webgpu: no adapter`,
      },
    ]);
  });

  it('says out_of_memory when every device ran out of memory', async () => {
    const runtime = module({ cuda: 'CUDA failure 2: out of memory' });
    const events: ComputeFallbackEvent[] = [];
    await createOnnxRuntime({
      loadModule: async () => runtime,
      onDeviceFailed: () => {},
      onComputeFallback: (event) => events.push(event),
    }).openSession('model.onnx', { operation: 'vision.shots', candidates: ['cuda', 'cpu'] });
    expect(events.map((event) => event.reason)).toEqual(['out_of_memory']);
  });

  it("records the caller's wanted backends when it offers only the CPU", async () => {
    const events: ComputeFallbackEvent[] = [];
    await createOnnxRuntime({
      loadModule: async () => module(),
      onComputeFallback: (event) => events.push(event),
    }).openSession('model.onnx', {
      operation: 'vision.ocr',
      candidates: ['cpu'],
      cpuReason: { reason: 'disabled', detail: 'TAALCUT_FORCE_CPU', wanted: ['cuda', 'webgpu'] },
    });
    expect(events).toEqual([
      {
        operation: 'vision.ocr',
        wanted: ['cuda', 'webgpu'],
        reason: 'disabled',
        detail: 'TAALCUT_FORCE_CPU',
      },
    ]);
  });
});

describe('missing CUDA libraries', () => {
  it('finds them on LD_LIBRARY_PATH or in the system folders', () => {
    expect(
      missingCudaLibraries({ libraryPath: '/opt/cuda13/lib', exists: runtimeOnPath('/opt/cuda13/lib') }),
    ).toEqual([]);
    expect(missingCudaLibraries({ libraryPath: '', exists: () => false })).toEqual([
      'libcudart.so.13',
      'libcublas.so.13',
      'libcublasLt.so.13',
      'libcurand.so.10',
      'libcuda.so.1',
    ]);
  });

  it('blames the driver when libcuda is missing, and leaves other failures as they are', () => {
    expect(cudaFailureDetail(NO_PROVIDER, { libraryPath: '', exists: () => false })).toMatch(
      /libcuda\.so\.1 not found \(the NVIDIA driver is not installed\)$/,
    );
    expect(cudaFailureDetail('CUDA failure 100: no CUDA-capable device', { exists: () => false })).toBe(
      'CUDA failure 100: no CUDA-capable device',
    );
  });

  it('says a runtime installed since this process started is used from its next start', () => {
    const lib = '/components/installed/cuda-runtime-13/13.4.3-837da78cbfae/lib';
    const search = {
      libraryPath: '',
      exists: (path: string) => path.startsWith(lib) || path.endsWith('libcuda.so.1'),
    };
    expect(cudaFailureDetail(NO_PROVIDER, { ...search, installedRuntime: () => lib })).toMatch(
      /libcudart\.so\.13, .* not found \(cuda-runtime-13 was installed after this process started: CUDA from its next start\)$/,
    );
    expect(cudaFailureDetail(NO_PROVIDER, { ...search, installedRuntime: () => undefined })).toMatch(
      /\(cuda-runtime-13 is not on LD_LIBRARY_PATH\)$/,
    );
  });
});

const machine = (apis: MachineAccelerators['apis'], extra: Partial<MachineAccelerators> = {}) =>
  ({ platform: 'linux', apis, forcedCpu: false, ...extra }) satisfies MachineAccelerators;

describe('usableDevices', () => {
  const ROWS = ['cuda', 'webgpu', 'cpu'] as const;

  it('keeps every row this machine runs, in order', () => {
    expect(usableDevices(ROWS, machine(['cuda', 'vulkan']))).toEqual(['cuda', 'webgpu', 'cpu']);
  });

  it('drops CUDA where the probe has none (an old driver, CUDA_VISIBLE_DEVICES=-1, AMD or Intel)', () => {
    expect(usableDevices(ROWS, machine(['vulkan']))).toEqual(['webgpu', 'cpu']);
  });

  it('keeps only the CPU without a GPU API, or when the CPU was forced', () => {
    expect(usableDevices(ROWS, machine([]))).toEqual(['cpu']);
    expect(usableDevices(ROWS, machine([], { forcedCpu: true }))).toEqual(['cpu']);
  });

  it('uses the table as it is when the probe failed', () => {
    expect(usableDevices(ROWS, undefined)).toEqual(ROWS);
  });

  it('runs WebGPU on Metal, Vulkan or Direct3D 12, and Core ML on a Mac only', () => {
    expect(canRun('webgpu', machine(['metal'], { platform: 'darwin' }))).toBe(true);
    expect(canRun('webgpu', machine(['directml'], { platform: 'win32' }))).toBe(true);
    expect(canRun('coreml', machine(['metal'], { platform: 'darwin' }))).toBe(true);
    expect(canRun('coreml', machine(['vulkan']))).toBe(false);
    expect(canRun('directml', machine(['vulkan']))).toBe(false);
  });

  it('says disabled for a forced CPU and no_accelerator otherwise', () => {
    expect(cpuReasonFor(ROWS, machine([], { forcedCpu: true })).reason).toBe('disabled');
    expect(cpuReasonFor(ROWS, machine([]))).toEqual({
      reason: 'no_accelerator',
      detail: 'no GPU API for cuda, webgpu (usable: none)',
    });
  });
});
