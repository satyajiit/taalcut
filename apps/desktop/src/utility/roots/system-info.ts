// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → About (appContract.system), served by the agent process: the
 * hardware probe and tier, what local models run on (models' computeReport
 * over the live profiles and the embedded runtime; ADR 0002, GPU first),
 * and the components, which the jobs process lists (componentList).
 */
import {
  implementContract,
  systemContract,
  unwrapRpc,
  type AsyncResult,
  type Component,
  type ComputeReport,
  type Downloads,
  type GpuSetup,
  type GpuSummary,
  type HardwareReport,
  type ModelModuleId,
} from '@taalcut/core';
import type { ComponentStatus, DownloadSetStatus } from '@taalcut/jobs';
import type { ProbedHardware } from '../../shared/tokens';
import { toWire } from '../../shared/wire';
import { componentBase, fromEntry, pace, publicError } from './downloads-wire';

const STATUS: Record<ComponentStatus['state'], Component['status'] | undefined> = {
  installed: 'installed',
  // Its files are current; the manifest has since replaced its licence notice, and the old one stays until then.
  notice_outdated: 'installed',
  update_available: 'update-available',
  not_installed: 'not-installed',
  unsupported: undefined,
};

/** One GPU as the UI shows it (core's gpuSummarySchema): 'NVIDIA GeForce RTX 4090 · 24 GB · CUDA · driver …'. */
function gpuSummary(gpu: ProbedHardware['info']['gpus'][number]): GpuSummary {
  return {
    name: gpu.name,
    vendor: gpu.vendor,
    ...(gpu.vramBytes && !gpu.unifiedMemory ? { vramBytes: gpu.vramBytes } : {}),
    ...(gpu.driverVersion ? { driverVersion: gpu.driverVersion } : {}),
    apis: [...gpu.apis],
  };
}

/** The probe and its tier; with what an NVIDIA GPU still needs, where that applies (gpu-setup.ts). */
export function hardwareReport({ info, assessment }: ProbedHardware, gpuSetup?: GpuSetup): HardwareReport {
  return {
    info: {
      platform: info.platform,
      arch: info.arch,
      chip: info.chip,
      ...(info.machineModel ? { machineModel: info.machineModel } : {}),
      memoryBytes: info.memoryBytes,
      ...(info.gpuCores ? { gpuCores: info.gpuCores } : {}),
      cpuCores: { ...info.cpuCores },
      freeDiskBytes: info.freeDiskBytes,
      osVersion: info.osVersion,
      ...(info.osName ? { osName: info.osName } : {}),
      gpus: info.gpus.map(gpuSummary),
    },
    tier: assessment.tier,
    shortfalls: [...assessment.shortfalls],
    labelKey: assessment.labelKey,
    shortfallKeys: [...assessment.shortfallKeys],
    ...(gpuSetup ? { gpuSetup } : {}),
  };
}

/**
 * The jobs each component serves (tools/components ids), so first run and Settings › Models lead with what a model
 * is for ("Captions from speech · Whisper tiny") rather than a product name alone. Runtimes and tools that serve no
 * one job stay unnamed.
 */
const USED_BY: Readonly<Record<string, readonly ModelModuleId[]>> = {
  'local-llm-runtime': ['agent', 'vision'],
  'local-llm-runtime-cuda': ['agent', 'vision'],
  'local-llm-runtime-vulkan': ['agent', 'vision'],
  'local-llm-qwen3-5-4b': ['agent', 'vision'],
  'local-llm-qwen3-5-4b-mmproj': ['vision'],
  'local-llm-qwen3-5-0-8b': ['agent'],
  'embeddinggemma-2': ['embeddings'],
  'embeddinggemma-2-coreml': ['embeddings'],
  'ppocr-v5-devanagari': ['vision'],
  'ppocr-v5-latin': ['vision'],
  transnetv2: ['vision'],
  'transnetv2-coreml': ['vision'],
  'whisper-cpp': ['speech'],
  'whisper-server': ['speech'],
  'whisper-server-cuda': ['speech'],
  'whisper-tiny': ['speech'],
  'whisper-small-q8-0': ['speech'],
  'whisper-medium-q5-0': ['speech'],
  'silero-vad': ['speech'],
  'anuvani-lid': ['speech'],
  'beat-this': ['music'],
  'sfx-pack': ['music'],
};

export const usedByOf = (id: string): readonly ModelModuleId[] => USED_BY[id] ?? [];

/**
 * The jobs process's component statuses as Settings → About lists them (unsupported ones left out). A component
 * the download of everything this Mac needs covers (`set`) is `needed` and says what that download is doing with
 * it (UX2-DOWNLOADER); any other one says what the manager knows: installed, downloading for another caller, or
 * failed with the reason it kept.
 */
export function componentList(
  statuses: readonly ComponentStatus[],
  set?: DownloadSetStatus,
  unaccepted: ReadonlySet<string> = new Set(),
): Component[] {
  const inSet = new Map((set?.entries ?? []).map((entry) => [entry.status.id, entry]));
  return statuses.flatMap((component): Component[] => {
    const entry = inSet.get(component.id);
    if (entry) return [fromEntry(entry, usedByOf(component.id))];
    const stored = STATUS[component.state];
    if (!stored) return [];
    // LNX1-TRM: whether the person accepted its owner's terms (a component that states some, e.g. the CUDA runtime).
    const base = componentBase(component, usedByOf(component.id), !unaccepted.has(component.id));
    if (component.installing) {
      const progress = component.progress;
      const bytesDone = progress?.phase === 'downloading' ? progress.bytesDone : component.partialBytes;
      return [{ ...base, status: 'downloading', ...pace(progress, bytesDone) }];
    }
    // A part that isn't here, or one whose replaced licence notice didn't arrive (its old one kept), says why.
    if (component.lastError && (component.state === 'not_installed' || component.state === 'notice_outdated'))
      return [{ ...base, status: 'failed', error: publicError(component.lastError) }];
    return [{ ...base, status: stored }];
  });
}

/** An agent composed without a jobs process (tests): it has no components, so nothing is needed here. */
export const NOTHING_TO_DOWNLOAD: Downloads = {
  state: 'ready',
  components: [],
  counts: { installed: 0, downloading: 0, queued: 0, paused: 0, failed: 0, missing: 0 },
  bytesTotal: 0,
  bytesDone: 0,
  bytesPerSecond: 0,
  requiredBytes: 0,
};

export interface SystemDeps {
  readonly hardware: () => Promise<ProbedHardware>;
  /** models' computeReport for this machine. */
  readonly compute: (hardware: ProbedHardware) => AsyncResult<ComputeReport>;
  /** From the jobs process (componentInstallerContract.list). */
  readonly components: () => Promise<Component[]>;
  /** From the jobs process (componentInstallerContract.downloads). */
  readonly downloads: () => Promise<Downloads>;
  /** What the NVIDIA GPU still needs (LNX1-TRM, gpu-setup.ts gpuSetupOf); none when absent. */
  readonly gpuSetup?: (hardware: ProbedHardware) => Promise<GpuSetup | undefined>;
}

export function systemRouter(deps: SystemDeps) {
  const os = implementContract(systemContract);
  return os.router({
    hardware: os.hardware.handler(async () => {
      const probed = await deps.hardware();
      return hardwareReport(probed, await deps.gpuSetup?.(probed));
    }),
    components: os.components.handler(() => deps.components()),
    downloads: os.downloads.handler(() => deps.downloads()),
    compute: os.compute.handler(async () => toWire(unwrapRpc(await deps.compute(await deps.hardware())))),
  });
}
