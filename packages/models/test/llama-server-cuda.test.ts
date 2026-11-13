// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The local LLM on Linux NVIDIA (LNX1-ML), against the fake llama-server: the download set installs
 * `local-llm-runtime-cuda` instead of the base, so the supervisor launches that build, on the probe's CUDA device,
 * every layer on it, with as many slots of the tier's window as the free VRAM holds; a CUDA that dies twice goes to
 * the Vulkan build, then the CPU (`--device none`); TAALCUT_FORCE_CPU runs the CPU, `disabled`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLlamaServerDriver,
  createLocalRuntimeManager,
  createMemoryComponentInstaller,
  llamaCppRuntimeSpec,
  llamaServerArgs,
  MAX_LOCAL_SLOTS,
  VRAM_RESERVE_BYTES,
  vramSlots,
  type ComputeBackend,
  type LocalRuntimeLogEvent,
  type LocalRuntimeManager,
  type LocalRuntimeManagerDeps,
} from '@taalcut/models';
import { createFakeSidecarSpawn, freeLoopbackPort, type FakeSidecarSpawn } from './support/sidecar';

const MIB = 1024 ** 2;
const LINUX_NVIDIA: readonly ComputeBackend[] = ['cuda', 'vulkan', 'webgpu', 'cpu'];
const FREE_VRAM = 20_150 * MIB;
const WEIGHTS = {
  'local-llm-qwen3-5-4b': 'qwen3.5-4b-q4_k_m.gguf',
  'local-llm-qwen3-5-4b-mmproj': 'qwen3.5-4b-mmproj-bf16.gguf',
};

let sidecars: FakeSidecarSpawn;
let log: LocalRuntimeLogEvent[];
let managers: LocalRuntimeManager[];
beforeEach(() => {
  sidecars = createFakeSidecarSpawn();
  log = [];
  managers = [];
});
afterEach(async () => {
  for (const manager of managers) await manager.stop();
  await sidecars.killAll();
});

async function linux(builds: readonly string[], options: Partial<LocalRuntimeManagerDeps> = {}) {
  const installer = createMemoryComponentInstaller({ files: WEIGHTS });
  for (const id of [...builds, ...Object.keys(WEIGHTS)]) await installer.install(id);
  const manager = createLocalRuntimeManager({
    spec: llamaCppRuntimeSpec('high'),
    installer,
    driver: createLlamaServerDriver({
      spawn: sidecars,
      freePort: freeLoopbackPort,
      healthIntervalMs: 20,
      stopGraceMs: 1_000,
      env: { LD_LIBRARY_PATH: '/components/cuda-runtime-13/lib' },
      log: (event) => log.push(event),
    }),
    backends: LINUX_NVIDIA,
    gpu: { cudaDeviceId: 1, vramBytes: FREE_VRAM },
    tier: 'high',
    idleUnloadMs: 0,
    maxRestarts: 0,
    restartDelayMs: () => 0,
    log: (event) => log.push(event),
    ...options,
  });
  managers.push(manager);
  return manager;
}

const arg = (args: readonly string[], flag: string) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const window = () => llamaCppRuntimeSpec('high').models[0]!.contextWindow;

describe('vramSlots', () => {
  const model = llamaCppRuntimeSpec('high').models[0]!;

  it('keeps one slot at the window on unified memory', () => {
    expect(vramSlots(model, undefined)).toEqual({
      parallel: 1,
      ctxSize: model.contextWindow,
      allLayers: true,
    });
  });

  it("fills a 4090's free memory with slots of the tier's window, up to the cap", () => {
    expect(vramSlots(model, FREE_VRAM)).toEqual({
      parallel: MAX_LOCAL_SLOTS,
      ctxSize: model.contextWindow * MAX_LOCAL_SLOTS,
      allLayers: true,
    });
    // Two windows' worth beyond the reserve and the weights: two slots.
    const two = vramSlots(model, VRAM_RESERVE_BYTES + 4.2e9 + 2.1 * 41_994 * model.contextWindow);
    expect(two.parallel).toBe(2);
  });

  it('leaves the layers to --fit on a GPU too small for one window', () => {
    const small = vramSlots(model, 6 * 1024 * MIB);
    expect(small).toEqual({ parallel: 1, ctxSize: model.contextWindow, allLayers: false });
    const args = llamaServerArgs({
      model,
      weights: '/w.gguf',
      port: 1,
      backend: 'cuda',
      slots: small,
      device: 'CUDA0',
    });
    expect(args).not.toContain('--n-gpu-layers');
    expect(arg(args, '--device')).toBe('CUDA0');
  });
});

describe('the local LLM on Linux NVIDIA', () => {
  it('runs the CPU on the CUDA build when it is the only one installed and the GPU is turned off', async () => {
    const manager = await linux(['local-llm-runtime-cuda'], { backends: ['cpu'], forcedCpu: true });
    expect((await manager.start()).ok).toBe(true);
    const [spawned] = sidecars.spawned;
    expect([spawned?.command, arg(spawned!.args, '--device')]).toEqual([
      '/components/local-llm-runtime-cuda/llama-server',
      'none',
    ]);
  });

  it("runs the CUDA build on the probe's device, every layer on it, slots sized to the free VRAM", async () => {
    const manager = await linux(['local-llm-runtime-cuda']);
    expect((await manager.start()).ok).toBe(true);
    const [spawned] = sidecars.spawned;
    expect(spawned?.command).toBe('/components/local-llm-runtime-cuda/llama-server');
    expect([
      arg(spawned!.args, '--device'),
      arg(spawned!.args, '--n-gpu-layers'),
      arg(spawned!.args, '--parallel'),
      arg(spawned!.args, '--ctx-size'),
    ]).toEqual(['CUDA1', '99', '4', String(window() * 4)]);
    expect(spawned?.env['LD_LIBRARY_PATH']).toBe('/components/cuda-runtime-13/lib');
    expect(await manager.loadedModels()).toMatchObject({
      ok: true,
      value: [{ id: 'qwen3.5-4b', compute: { backend: 'cuda', accelerated: true } }],
    });
  });

  it('goes from a CUDA that dies twice to the Vulkan build, then the CPU on a GPU build, and logs why', async () => {
    sidecars.setControl({ FAKE_EXIT_ON_GPU: '1' });
    const manager = await linux(['local-llm-runtime-cuda', 'local-llm-runtime-vulkan']);
    expect((await manager.start()).ok).toBe(true);
    expect(
      sidecars.spawned.map((s) => [
        s.command.split('/')[2],
        arg(s.args, '--device'),
        arg(s.args, '--n-gpu-layers'),
      ]),
    ).toEqual([
      ['local-llm-runtime-cuda', 'CUDA1', '99'],
      ['local-llm-runtime-cuda', 'CUDA1', '99'],
      ['local-llm-runtime-vulkan', undefined, '99'],
      ['local-llm-runtime-cuda', 'none', '0'],
    ]);
    expect(log).toContainEqual({
      type: 'cpu_fallback',
      model: 'qwen3.5-4b',
      reason: 'gpu_failed_at_runtime',
    });
    expect(log.filter((event) => event.type === 'accelerator_failed')).toMatchObject([
      { backend: 'cuda', next: 'vulkan', detail: expect.stringContaining('failed to allocate buffer') },
      { backend: 'vulkan', next: 'cpu' },
    ]);
  });

  it('names the missing CUDA runtime when the CUDA build has no CUDA0', async () => {
    sidecars.setControl({ FAKE_EXIT_ON_GPU: '1', FAKE_GPU_ERROR: 'invalid device: CUDA0' });
    const manager = await linux(['local-llm-runtime-cuda']);
    await manager.start();
    const [failed] = log.filter((event) => event.type === 'accelerator_failed');
    expect(failed).toMatchObject({ backend: 'cuda', next: 'cpu' });
    const detail = failed && 'detail' in failed ? failed.detail : '';
    expect(detail.split('\n').slice(0, 2)).toEqual([
      expect.stringMatching(/^llama-server exited \(code 1\) while loading/),
      'invalid device: CUDA0',
    ]);
    expect(detail).toContain('libcudart.so.13');
  });

  it("pins the Vulkan build to the probe's GPU, not the integrated one beside it, and sizes its slots", async () => {
    sidecars.setControl({
      FAKE_EXIT_ON_GPU: '1',
      FAKE_DEVICES: [
        '  Vulkan0: Intel(R) Graphics (RPL-S) (47220 MiB, 42498 MiB free)',
        '  Vulkan1: NVIDIA GeForce RTX 4090 (24564 MiB, 20773 MiB free)',
      ].join(';'),
    });
    const manager = await linux(['local-llm-runtime-cuda', 'local-llm-runtime-vulkan'], {
      gpu: {
        cudaDeviceId: 1,
        vramBytes: FREE_VRAM,
        name: 'NVIDIA GeForce RTX 4090',
        totalVramBytes: 24_564 * MIB,
      },
    });
    await manager.start();
    const vulkan = sidecars.spawned.filter((s) => s.command.includes('local-llm-runtime-vulkan'));
    expect(vulkan.map((s) => s.args.join(' '))[0]).toBe('--list-devices');
    expect(vulkan.slice(1).map((s) => [arg(s.args, '--device'), arg(s.args, '--parallel')])).toEqual([
      ['Vulkan1', '4'],
    ]);
  });

  it('reads a function env at each spawn, so a runtime installed since this process started reaches the next', async () => {
    let lib = '/components/cuda-runtime-13/old/lib';
    const driver = createLlamaServerDriver({
      spawn: sidecars,
      freePort: freeLoopbackPort,
      healthIntervalMs: 20,
      stopGraceMs: 1_000,
      env: () => ({ LD_LIBRARY_PATH: lib }),
    });
    const manager = await linux(['local-llm-runtime-cuda'], { driver });
    expect((await manager.start()).ok).toBe(true);
    await manager.stop();
    lib = '/components/cuda-runtime-13/new/lib';
    expect((await manager.start()).ok).toBe(true);
    expect(sidecars.spawned.map((s) => s.env['LD_LIBRARY_PATH'])).toEqual([
      '/components/cuda-runtime-13/old/lib',
      '/components/cuda-runtime-13/new/lib',
    ]);
  });

  it('runs the base build on the CPU when it is there, and says `disabled` under TAALCUT_FORCE_CPU', async () => {
    const manager = await linux(['local-llm-runtime-cuda', 'local-llm-runtime'], {
      backends: ['cpu'],
      forcedCpu: true,
    });
    expect((await manager.start()).ok).toBe(true);
    const [spawned] = sidecars.spawned;
    expect(spawned?.command).toBe('/components/local-llm-runtime/llama-server');
    expect([
      arg(spawned!.args, '--device'),
      arg(spawned!.args, '--n-gpu-layers'),
      arg(spawned!.args, '--parallel'),
    ]).toEqual(['none', '0', '1']);
    expect(log).toContainEqual({ type: 'cpu_fallback', model: 'qwen3.5-4b', reason: 'disabled' });
    expect(await manager.loadedModels()).toMatchObject({
      ok: true,
      value: [{ id: 'qwen3.5-4b', compute: { backend: 'cpu', cpuReason: 'disabled' } }],
    });
  });
});
