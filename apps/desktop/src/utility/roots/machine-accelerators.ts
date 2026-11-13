// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One description of this machine's accelerators from the hardware probe (LNX1 seam 1), for every device table in
 * vision and audio: OCR (`planOcrBackends`), embeddings (`embeddingProfile`), TransNetV2 (`shotModelRuntime`),
 * Beat This! (`beatDevices`) and whisper (`planAsrBackend`). They read it instead of `process.platform` alone, so a
 * Linux PC without NVIDIA doesn't try CUDA first, and an NVIDIA driver below CUDA 13's floor goes to WebGPU. EAR1's
 * listening models and spectrogram graphs read it too (`machineListenPlan`).
 *
 * - `apis`: the GPUs' usable APIs (models' `usableGpuApis`: `cuda` only where CUDA 13 runs).
 * - `cudaDeviceId`, `vendor`, `vramBytes`: the GPU CUDA runs on (the probe's first that fits), else the primary
 *   GPU; its free memory when the probe read it, else its total; none with unified memory.
 * - `forcedCpu`: TAALCUT_FORCE_CPU.
 *
 * A failed probe gives undefined: each table keeps its platform's row as it is, and the failure is logged once.
 *
 * The CUDA libraries come from the `cuda-runtime-13` component, found through LD_LIBRARY_PATH, which the loader read
 * when this process started (accelerator-env.ts). `cudaRuntimeLibraries` names the installed one to the ONNX
 * runtimes, so a CUDA session that fails because the runtime was installed after this process started says so,
 * and goes to the next device; sidecars get `sidecarAcceleratorEnv`, read at each spawn, and use it at once.
 */
import { join } from 'node:path';
import { beatDevicePlan, listenDevicePlan, type BeatDevicePlan, type ListenDevicePlan } from '@taalcut/audio';
import { installedComponentDirSync } from '@taalcut/jobs';
import type { LibrarySearch, MachineAccelerators } from '@taalcut/media';
import { cudaRuntimeFits, GPU_APIS, usableGpuApis, type GpuInfo, type HardwareInfo } from '@taalcut/models';
import { hostPlatform } from '../../platform';
import type { ProbedHardware } from '../../shared/tokens';
import { acceleratorEnv, ACCELERATOR_LIBRARIES, CUDA_RUNTIME_COMPONENT } from '../accelerator-env';
import { probeFailure } from './hardware';

export function machineAccelerators(info: HardwareInfo): MachineAccelerators {
  const usable = new Set(info.gpus.flatMap(usableGpuApis));
  const cuda = info.gpus.find((gpu) => cudaRuntimeFits(gpu) && gpu.cudaDeviceId !== undefined);
  const gpu: GpuInfo | undefined = cuda ?? info.gpus[0];
  const vramBytes = gpu && !gpu.unifiedMemory ? (gpu.vramFreeBytes ?? gpu.vramBytes) : undefined;
  return {
    platform: info.platform,
    apis: GPU_APIS.filter((api) => usable.has(api)),
    ...(gpu ? { vendor: gpu.vendor } : {}),
    ...(cuda?.cudaDeviceId !== undefined ? { cudaDeviceId: cuda.cudaDeviceId } : {}),
    ...(vramBytes !== undefined ? { vramBytes } : {}),
    forcedCpu: info.forcedCpu ?? false,
  };
}

/** The accelerators of the probed hardware, once per process; undefined (logged once) when the probe failed. */
export function probedAccelerators(
  hardware: () => Promise<ProbedHardware>,
  log: (line: string) => void = (line) => console.warn(line),
): () => Promise<MachineAccelerators | undefined> {
  let warned = false;
  return async () => {
    try {
      return machineAccelerators((await hardware()).info);
    } catch (cause) {
      if (!warned)
        log(
          `[compute] hardware not probed (${probeFailure(cause)}): each device table keeps its platform's row`,
        );
      warned = true;
      return undefined;
    }
  };
}

/** `<userData>/components`, where the component manager installs. */
export const componentsRoot = (userData: string): string => join(userData, 'components');

/** Where the ONNX runtimes look for a CUDA failure's missing libraries: the installed cuda-runtime-13 too. */
export function cudaRuntimeLibraries(
  root: string,
  installedDir: (root: string, id: string) => string | undefined = installedComponentDirSync,
): LibrarySearch {
  const lib = ACCELERATOR_LIBRARIES.find((entry) => entry.component === CUDA_RUNTIME_COMPONENT)?.dir ?? 'lib';
  return {
    installedRuntime: () => {
      const dir = installedDir(root, CUDA_RUNTIME_COMPONENT);
      return dir ? join(dir, lib) : undefined;
    },
  };
}

/**
 * Beat This!'s devices on this machine, planned once per caller: the probe's accelerators and the installed CUDA
 * runtime. The audio jobs and the breakdown's beats both open their ORT runtime with it.
 */
export function machineBeatPlan(
  hardware: () => Promise<ProbedHardware>,
  root: string,
  log?: (line: string) => void,
): () => Promise<BeatDevicePlan> {
  const accelerators = probedAccelerators(hardware, log);
  const cudaLibraries = cudaRuntimeLibraries(root);
  return async () => ({ ...beatDevicePlan(hostPlatform().name, await accelerators()), cudaLibraries });
}

/**
 * The listening models' and spectrogram graphs' devices on this machine (EAR1-F7, LISTEN_DEVICES: WebGPU then the
 * CPU on a Mac; CUDA, WebGPU, the CPU on Linux), planned once per caller like Beat This!'s: the probe's
 * accelerators (TAALCUT_FORCE_CPU gives the CPU alone, `disabled`) and the installed CUDA runtime.
 */
export function machineListenPlan(
  hardware: () => Promise<ProbedHardware>,
  root: string,
  log?: (line: string) => void,
): () => Promise<ListenDevicePlan> {
  const accelerators = probedAccelerators(hardware, log);
  const cudaLibraries = cudaRuntimeLibraries(root);
  return async () => ({ ...listenDevicePlan(hostPlatform().name, await accelerators()), cudaLibraries });
}

/**
 * The environment a sidecar (llama-server, whisper-server) adds at each spawn: the installed accelerator libraries'
 * folders before this process's own LD_LIBRARY_PATH (acceleratorEnv), so one installed since this process started is
 * used by the next sidecar.
 */
export function sidecarAcceleratorEnv(root: string): () => Record<string, string> {
  return () => acceleratorEnv({ componentsRoot: root });
}
