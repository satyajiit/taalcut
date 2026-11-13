// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The models side of Settings → About's "what runs on this machine"
 * (appContract.system.compute; ADR 0002, GPU first): the GPU, and for each
 * module whose effective chain has a local model, the runtime and backend that
 * model runs on, with the logged reason when that is the CPU. When the
 * embedded runtime is up, its own report wins over the plan (a GPU that failed
 * at load shows as a CPU fallback).
 */
import { ok, type AsyncResult, type ComputeReport } from '@taalcut/core';
import { usableGpuApis } from '../hardware/cuda';
import type { HardwareAssessment } from '../hardware/tiers';
import type { GpuApi } from '../hardware/types';
import { LOCAL_RUNTIME_PROVIDER, type LocalRuntime } from '../local-runtime/types';
import { MODULE_IDS, type ModelChoice } from '../modules';
import { createCatalog, type Catalog, type CatalogEntry } from '../registry/catalog';
import type { ModelProfiles } from '../registry/profiles';
import { fallbackReasonKey, optionCompute } from './model-options';

export interface ComputeReportDeps {
  readonly profiles: ModelProfiles;
  readonly hardware: Pick<HardwareAssessment, 'compute'>;
  readonly catalog?: Catalog;
  /** The embedded runtime, when this process supervises it. */
  readonly localRuntime?: Pick<LocalRuntime, 'status' | 'loadedModels'>;
}

type ModuleRow = ComputeReport['modules'][number];

/** Product names, shown as is. */
const API_NAMES: Readonly<Record<GpuApi, string>> = {
  metal: 'Metal',
  cuda: 'CUDA',
  rocm: 'ROCm',
  directml: 'DirectML',
  vulkan: 'Vulkan',
};

/** 'Metal 3' from metalFamily 'metal3'; otherwise the first API Taalcut can use on the GPU, e.g. 'CUDA'. */
function gpuApi(gpu: NonNullable<HardwareAssessment['compute']['gpu']>): string | undefined {
  const metal = /^metal(\d+)$/i.exec(gpu.metalFamily ?? '');
  if (metal) return `Metal ${metal[1]}`;
  const first = usableGpuApis(gpu)[0];
  return first ? API_NAMES[first] : undefined;
}

/** The GPU as About shows it: name, cores (Apple), API, and off a Mac its VRAM and driver (LNX1). */
function gpuRow(gpu: NonNullable<HardwareAssessment['compute']['gpu']>): NonNullable<ComputeReport['gpu']> {
  const api = gpuApi(gpu);
  return {
    name: gpu.name,
    ...(gpu.cores ? { cores: gpu.cores } : {}),
    ...(api ? { api } : {}),
    ...(gpu.vramBytes && !gpu.unifiedMemory ? { vramBytes: gpu.vramBytes } : {}),
    ...(gpu.driverVersion ? { driverVersion: gpu.driverVersion } : {}),
  };
}

export async function computeReport(deps: ComputeReportDeps): AsyncResult<ComputeReport> {
  const catalog = deps.catalog ?? createCatalog();
  const backends = deps.hardware.compute.backends;
  const gpu = deps.hardware.compute.gpu;
  const running = deps.localRuntime?.status().state === 'running';
  const loaded = running ? await deps.localRuntime?.loadedModels() : undefined;

  const local = (choice: ModelChoice): { entry: CatalogEntry; choice: ModelChoice } | undefined => {
    const entry = catalog.find(choice);
    return entry?.local && entry.runtime && entry.compute?.length ? { entry, choice } : undefined;
  };

  const modules: ModuleRow[] = [];
  for (const module of MODULE_IDS) {
    const found = profilesLocal(deps.profiles.effective(module).chain, local);
    if (!found) continue;
    const actual =
      found.choice.provider === LOCAL_RUNTIME_PROVIDER && loaded?.ok
        ? loaded.value.find((m) => m.id === found.choice.model)?.compute
        : undefined;
    if (actual) {
      modules.push({
        module,
        runtime: found.entry.runtime!,
        backend: actual.backend,
        ...(actual.cpuReason ? { fallbackReasonKey: fallbackReasonKey(actual.cpuReason) } : {}),
      });
      continue;
    }
    const planned = optionCompute(found.entry, backends, deps.hardware.compute.forcedCpu);
    if (!planned) continue;
    modules.push({
      module,
      runtime: found.entry.runtime!,
      backend: planned.backend,
      ...(planned.fallbackReasonKey ? { fallbackReasonKey: planned.fallbackReasonKey } : {}),
    });
  }

  return ok({ ...(gpu ? { gpu: gpuRow(gpu) } : {}), modules });
}

/** The first local model in the chain: what runs on this Mac when the module runs locally. */
function profilesLocal<T>(chain: readonly ModelChoice[], local: (choice: ModelChoice) => T | undefined) {
  for (const choice of chain) {
    const found = local(choice);
    if (found) return found;
  }
  return undefined;
}
