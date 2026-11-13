// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * onnxruntime-node 1.30's CUDA provider, for real (LNX1-ML), on a hand-written MatMul + Relu graph. Linux x64 only
 * (the only build that lists `cuda`); each half skips with its reason elsewhere.
 *
 * - Without CUDA 13 on the loader's path (the normal `pnpm check`): the session goes to the next device and the
 *   failure names the libraries the loader missed. No GPU work.
 * - With `cuda-runtime-13`'s lib folder on LD_LIBRARY_PATH when the run starts: the session opens on CUDA with the
 *   probe's device id, a device id that doesn't exist fails, and the binding ignores every other CUDA option:
 *   a 1 MiB `gpu_mem_limit` (as `gpu_mem_limit`, `gpuMemLimit` or a session config entry) doesn't stop a 64 MiB
 *   MatMul. That is the evidence for media's runtime passing `deviceId` alone (runtime.ts).
 */
import { platform } from 'node:os';
import type { ComputeFallbackEvent } from '@taalcut/core';
import {
  createOnnxRuntime,
  encodeOnnxModel,
  missingCudaLibraries,
  type OnnxDeviceFailure,
  type OnnxModule,
} from '@taalcut/media';
import { describe, expect, it } from 'vitest';

interface Ort {
  readonly Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
  readonly InferenceSession: {
    create(
      model: Uint8Array,
      options: Record<string, unknown>,
    ): Promise<{ run(feeds: Record<string, unknown>): Promise<unknown>; release(): Promise<void> }>;
  };
  listSupportedBackends(): readonly { readonly name: string }[];
}

const load = async () => (await import('onnxruntime-node')) as unknown as Ort;
const loadModule = async () => (await load()) as unknown as OnnxModule;

const ORT_LISTS_CUDA =
  platform() === 'linux' &&
  process.arch === 'x64' &&
  (await load()
    .then((ort) => ort.listSupportedBackends().some((b) => b.name === 'cuda'))
    .catch(() => false));
const MISSING = missingCudaLibraries();
const RUNTIME_ON_PATH = ORT_LISTS_CUDA && MISSING.length === 0;

/** Y = Relu(X · W), X and W [n, n]. */
function matmul(n: number): Uint8Array {
  return encodeOnnxModel({
    inputs: [
      { name: 'X', dims: [n, n] },
      { name: 'W', dims: [n, n] },
    ],
    outputs: [{ name: 'Y', dims: [n, n] }],
    nodes: [
      { op: 'MatMul', inputs: ['X', 'W'], outputs: ['H'] },
      { op: 'Relu', inputs: ['H'], outputs: ['Y'] },
    ],
  });
}

async function runs(ort: Ort, options: Record<string, unknown>, n = 4096): Promise<true | string> {
  try {
    const session = await ort.InferenceSession.create(matmul(n), { logSeverityLevel: 3, ...options });
    const x = new ort.Tensor('float32', new Float32Array(n * n).fill(0.01), [n, n]);
    const w = new ort.Tensor('float32', new Float32Array(n * n).fill(0.5), [n, n]);
    await session.run({ X: x, W: w });
    await session.release();
    return true;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

describe.skipIf(!ORT_LISTS_CUDA || RUNTIME_ON_PATH)('CUDA provider without CUDA 13 on the path', () => {
  it('opens the next device and names the missing libraries', async () => {
    const failed: OnnxDeviceFailure[] = [];
    const events: ComputeFallbackEvent[] = [];
    const session = await createOnnxRuntime({
      loadModule,
      onDeviceFailed: (failure) => failed.push(failure),
      onComputeFallback: (event) => events.push(event),
      logSeverityLevel: 4,
    }).openSession(matmul(8), { operation: 'vision.ocr', candidates: ['cuda', 'cpu'] });
    expect(session.ok && session.value.backend).toBe('cpu');
    expect(failed.map((f) => [f.backend, f.reason, f.next])).toEqual([['cuda', 'accelerator_failed', 'cpu']]);
    for (const library of MISSING) expect(failed[0]?.detail).toContain(library);
    expect(events).toMatchObject([{ reason: 'accelerator_failed', wanted: ['cuda'] }]);
    expect(events[0]?.detail).toContain(MISSING[0]);
    if (session.ok) await session.value.release();
  });
});

describe.skipIf(!RUNTIME_ON_PATH)('CUDA provider with CUDA 13 on the path', () => {
  it("opens on CUDA with the probe's device id", async () => {
    const session = await createOnnxRuntime({ loadModule, cuda: { deviceId: 0 } }).openSession(matmul(256), {
      operation: 'vision.ocr',
      candidates: ['cuda', 'cpu'],
    });
    expect(session.ok && session.value.backend).toBe('cuda');
    if (session.ok) await session.value.release();
  });

  it('honours deviceId: a device that does not exist fails', async () => {
    const ort = await load();
    expect(await runs(ort, { executionProviders: [{ name: 'cuda', deviceId: 0 }] }, 256)).toBe(true);
    expect(await runs(ort, { executionProviders: [{ name: 'cuda', deviceId: 64 }] }, 256)).toMatch(/cuda/i);
  });

  it('ignores gpu_mem_limit, arena_extend_strategy and cudnn_conv_algo_search in every spelling', async () => {
    const ort = await load();
    const limit = 1024 * 1024;
    const provider = (extra: Record<string, unknown>) => ({
      executionProviders: [{ name: 'cuda', deviceId: 0, ...extra }],
    });
    // Each 4096 × 4096 float tensor is 64 MiB: a limit the provider honoured would fail the run.
    expect(
      await runs(
        ort,
        provider({
          gpu_mem_limit: String(limit),
          arena_extend_strategy: 'kSameAsRequested',
          cudnn_conv_algo_search: 'HEURISTIC',
        }),
      ),
    ).toBe(true);
    expect(await runs(ort, provider({ gpuMemLimit: limit, arenaExtendStrategy: 'kSameAsRequested' }))).toBe(
      true,
    );
    for (const key of ['ep.cuda.gpu_mem_limit', 'ep.CUDAExecutionProvider.gpu_mem_limit', 'gpu_mem_limit'])
      expect(await runs(ort, { ...provider({}), extra: { [key]: String(limit) } })).toBe(true);
  });
});
