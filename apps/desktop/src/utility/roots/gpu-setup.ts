// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hardware report's NVIDIA GPU setup (LNX1-TRM): models' `nvidiaGpuSetup` over the probe's GPUs and what this
 * process knows of the `cuda-runtime-13` component: its row from the jobs process (installed; NVIDIA's terms
 * accepted), its folder from the registry (every library the CUDA builds load from it is there: `intact`), and
 * this process's loader path, which main set when it forked the app's processes (`loaded`: false when it was
 * installed since, so the ONNX runtimes use it from the next start; accelerator-env.ts).
 *
 * Only where the GPU runtimes' libraries are components the loader is told about (the platform services'
 * `loaderSearchPath`: Linux); absent elsewhere. The jobs process uses `cudaRuntimeIntact` too: a download started
 * while the runtime's folder is missing libraries removes it first, so the download fetches it again.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Component, GpuSetup } from '@taalcut/core';
import { installedComponentDirSync, type ComponentManager } from '@taalcut/jobs';
import { nvidiaGpuSetup, type GpuInfo } from '@taalcut/models';
import { hostPlatform } from '../../platform';
import type { LoaderSearchPath } from '../../platform/types';
import { ACCELERATOR_LIBRARIES, CUDA_RUNTIME_COMPONENT } from '../accelerator-env';

/**
 * What the CUDA builds load from cuda-runtime-13's folder: media's CUDA_PROVIDER_LIBRARIES but the driver's
 * libcuda (kept here so this process needn't load media; test/gpu-setup.test.ts holds them equal).
 */
export const CUDA_RUNTIME_LIBRARIES = [
  'libcudart.so.13',
  'libcublas.so.13',
  'libcublasLt.so.13',
  'libcurand.so.10',
] as const;

export interface CudaRuntimeDisk {
  /** `<userData>/components`. */
  readonly root: string;
  /** Test seams: the registry's folder for a component, a file's presence, this process's environment. */
  readonly installedDir?: (root: string, id: string) => string | undefined;
  readonly exists?: (path: string) => boolean;
  readonly env?: NodeJS.ProcessEnv;
  /** Default the platform services'. */
  readonly searchPath?: LoaderSearchPath | undefined;
}

/** The installed runtime's library folder; undefined when it isn't installed. */
function libraryDir(disk: CudaRuntimeDisk): string | undefined {
  const dir = (disk.installedDir ?? installedComponentDirSync)(disk.root, CUDA_RUNTIME_COMPONENT);
  const lib = ACCELERATOR_LIBRARIES.find((entry) => entry.component === CUDA_RUNTIME_COMPONENT)?.dir ?? 'lib';
  return dir ? join(dir, lib) : undefined;
}

/** The libraries missing from the installed runtime's folder; undefined when it isn't installed. */
export function missingRuntimeLibraries(disk: CudaRuntimeDisk): string[] | undefined {
  const dir = libraryDir(disk);
  if (!dir) return undefined;
  const exists = disk.exists ?? existsSync;
  return CUDA_RUNTIME_LIBRARIES.filter((name) => !exists(join(dir, name)));
}

/** False when the runtime is installed but libraries are missing from its folder (a damaged install). */
export function cudaRuntimeIntact(disk: CudaRuntimeDisk): boolean {
  return (missingRuntimeLibraries(disk) ?? []).length === 0;
}

/**
 * Before a download starts: an installed runtime whose folder is missing libraries (the GPU setup's
 * `runtime_damaged`) is removed, so the download fetches it again (the card's "Reinstall" is the download's start).
 */
export async function repairCudaRuntime(
  manager: Pick<ComponentManager, 'remove'>,
  disk: CudaRuntimeDisk,
  log: (line: string) => void = (line) => console.warn(line),
): Promise<void> {
  const missing = missingRuntimeLibraries(disk);
  if (!missing || missing.length === 0) return;
  log(
    `[components] ${CUDA_RUNTIME_COMPONENT}: ${missing.join(', ')} missing from its folder; downloading it again`,
  );
  // Its dependants (the CUDA builds) stay: they load it by name, from the folder the download puts back.
  const removed = await manager.remove(CUDA_RUNTIME_COMPONENT, { force: true });
  if (!removed.ok) log(`[components] ${CUDA_RUNTIME_COMPONENT}: couldn't remove it (${removed.error.code})`);
}

/** NVIDIA's GPU setup for the hardware report, or undefined where it doesn't apply. */
export function gpuSetupOf(
  gpus: readonly GpuInfo[],
  row: Component | undefined,
  disk: CudaRuntimeDisk,
): GpuSetup | undefined {
  const search = 'searchPath' in disk ? disk.searchPath : hostPlatform().loaderSearchPath;
  if (!search) return undefined;
  const installed = row?.status === 'installed' || row?.status === 'update-available';
  const dir = installed ? libraryDir(disk) : undefined;
  const held = ((disk.env ?? process.env)[search.variable] ?? '').split(search.separator);
  return nvidiaGpuSetup(gpus, {
    installed,
    termsAccepted: row?.terms?.accepted ?? false,
    intact: cudaRuntimeIntact(disk),
    loaded: dir === undefined || held.includes(dir),
  });
}

/** The component whose GPU setup the hardware report carries, among the jobs process's rows. */
export const cudaRuntimeRow = (rows: readonly Component[]): Component | undefined =>
  rows.find((row) => row.id === CUDA_RUNTIME_COMPONENT);
