// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The embedded local runtime in the agent process (D16, spike 08: a
 * llama.cpp llama-server sidecar the app downloads as components; MLX1: on an
 * Apple silicon Mac of the High tier, Taalcut's MLX server serving the 9B,
 * `localRuntimeSpec`). It starts on the first on-device call (ModelClient's
 * localLease) and idles out; exports pause it so the GPU is free for the
 * render.
 *
 * The runtime and model weights are components of the signed manifest. The
 * jobs process installs them (it alone manages `<userData>/components`); this
 * slot asks it through main. Without a trusted manifest, or without the jobs
 * process, an on-device call fails and the chain moves on to its next model.
 *
 * The supervisor installs the runtime as the build the download picks here
 * (`install({ variant: true })`, LNX1-TRM). On Linux NVIDIA (LNX1) that is the
 * CUDA build (`local-llm-runtime-cuda`) once the person has accepted NVIDIA's
 * terms, the Vulkan build until then; the CUDA build runs on the probe's CUDA
 * device, sized to its free VRAM, and llama-server gets this
 * process's LD_LIBRARY_PATH (cuda-runtime-13, from the fork) and
 * CUDA_VISIBLE_DEVICES, nothing else of its environment. TAALCUT_FORCE_CPU runs
 * it on the CPU, `disabled`.
 */
import { err, ok, ProcessRestartedError } from '@taalcut/core';
import type { HardwareAssessment, LaunchGpu } from '@taalcut/models';
import {
  attachLocalRuntime,
  createEngineDriver,
  createLlamaServerDriver,
  createLocalRuntimeManager,
  createMlxServerDriver,
  localRuntimeSpec,
  type AttachedLocalRuntime,
  type ComponentInstaller,
  type LocalRuntimeManager,
  type LocalRuntimeSlot,
  type ModelRuntime,
} from '@taalcut/models';
import { createNodeSpawnPort, findFreeLoopbackPort } from '@taalcut/models/node';
import { sidecarAcceleratorEnv } from './machine-accelerators';

/** No installer (no port to main, e.g. tests): nothing can be installed. */
export const NO_INSTALLER: ComponentInstaller = {
  install: async () => err(ProcessRestartedError({ process: 'jobs' })),
  get: async () => undefined,
};

export interface LocalRuntimeOptions {
  readonly runtime: ModelRuntime;
  /** The jobs process's component manager, through main (componentInstallerOverRpc). */
  readonly installer: ComponentInstaller;
  readonly log?: (message: string) => void;
  /**
   * `<userData>/components`: llama-server gets the installed accelerator libraries at each spawn (acceleratorEnv),
   * so a cuda-runtime-13 installed since this process started is used by the next launch.
   */
  readonly componentsRoot?: string;
}

export function createLocalRuntimeSlot(options: LocalRuntimeOptions): LocalRuntimeSlot {
  const log = options.log ?? ((message: string) => console.warn(message));
  let manager: LocalRuntimeManager | undefined;
  let attached: AttachedLocalRuntime | undefined;

  return {
    async localLease(provider, signal, model) {
      if (!attached) return ok(undefined);
      return attached.localLease(provider, signal, model);
    },
    runtime: () => manager,
    start(hardware) {
      if (manager) return;
      const spawn = createNodeSpawnPort();
      manager = createLocalRuntimeManager({
        // This machine's models at the tier's context windows (packages/models SPEC "Context windows by tier").
        spec: localRuntimeSpec(hardware.tier),
        installer: options.installer,
        driver: createEngineDriver({
          'llama.cpp': createLlamaServerDriver({
            spawn,
            freePort: findFreeLoopbackPort,
            env: sidecarEnv(options.componentsRoot),
          }),
          mlx: createMlxServerDriver({ spawn, freePort: findFreeLoopbackPort }),
        }),
        backends: hardware.compute.backends,
        ...launchGpu(hardware.compute),
        ...(hardware.compute.forcedCpu ? { forcedCpu: true } : {}),
        tier: hardware.tier,
        log: (event) => log(`[local runtime] ${JSON.stringify(event)}`),
      });
      attached = attachLocalRuntime(manager, [options.runtime]);
    },
    stopForExport: () => (manager ? manager.stopForExport() : Promise.resolve(ok(undefined))),
    resumeAfterExport: () => (manager ? manager.resumeAfterExport() : Promise.resolve(ok(undefined))),
    async dispose() {
      attached?.detach();
      const stopped = await manager?.stop();
      if (stopped && !stopped.ok) log(`[local runtime] stop failed: ${stopped.error.code}`);
    },
  };
}

/** llama-server's GPU variables: this process's, then the installed accelerator libraries', read at each spawn. */
function sidecarEnv(root: string | undefined): () => Record<string, string> {
  const extra = root ? sidecarAcceleratorEnv(root) : () => ({});
  return () => ({ ...sidecarGpuEnv(process.env), ...extra() });
}

/** What llama-server's GPU builds need from this process's environment. */
const GPU_ENV_KEYS = ['LD_LIBRARY_PATH', 'CUDA_VISIBLE_DEVICES'] as const;

export function sidecarGpuEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(GPU_ENV_KEYS.flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]]])));
}

/**
 * The primary GPU's CUDA device, the video memory free when the probe ran, and its name and whole memory (to pin it
 * among the Vulkan build's devices); nothing with unified memory.
 */
export function launchGpu(compute: HardwareAssessment['compute']): { readonly gpu?: LaunchGpu } {
  const gpu = compute.gpu;
  if (!gpu || gpu.unifiedMemory) return {};
  const vramBytes = gpu.vramFreeBytes ?? gpu.vramBytes;
  const described: LaunchGpu = {
    ...(gpu.cudaDeviceId !== undefined ? { cudaDeviceId: gpu.cudaDeviceId } : {}),
    ...(vramBytes !== undefined ? { vramBytes } : {}),
    ...(gpu.name ? { name: gpu.name } : {}),
    ...(gpu.vramBytes !== undefined ? { totalVramBytes: gpu.vramBytes } : {}),
  };
  return Object.keys(described).length > 0 ? { gpu: described } : {};
}
