// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hardware → tier → default profile (G14, PRD 11; ADR 0002 GPU first).
 *
 * - Minimum: Apple Silicon (M1 or later) with 8 GB, 20 GB free disk, macOS 14.
 * - Recommended: M-series with 16 GB or more, and a GPU local models can use
 *   (Metal on an Apple GPU) with at least 8 GB it can address.
 * - High (Taalcut's rule; PRD 11 doesn't define it): 32 GB or more, a GPU
 *   with 16+ cores (Pro, Max and Ultra chips) and the Neural Engine, enough
 *   for local vision and a 4B-class local agent model at a usable speed.
 *
 * Off a Mac (LNX1) the tier follows the GPU, not the chip: a GPU with CUDA
 * (where CUDA 13 runs), ROCm or DirectML, 12 GiB of VRAM or more and 32 GB of
 * RAM is High; any GPU local models use (those, or Vulkan) with 8 GiB of VRAM
 * and 16 GB of RAM is Recommended; anything else is Minimum. The best GPU
 * decides. not_apple_silicon and macos_too_old are a Mac's; Ubuntu before 22.04
 * is os_too_old and an NVIDIA driver before 580 gpu_driver_old.
 *
 * GPU memory is the RAM on unified-memory Macs and the VRAM of a discrete GPU
 * elsewhere. A machine below the minimum still gets the Minimum tier, plus
 * shortfalls the UI can show.
 * Every tier starts on the Balanced profile; the tier and the machine's
 * compute backends decide which local models a chain may use and in what
 * order (catalogue minTier and compute), so an 8 GB Mac runs vision in the
 * cloud, a 16 GB one runs it locally on the GPU, and a local model that would
 * run on the CPU goes behind every GPU or cloud option.
 */
import { DEFAULT_PROFILE_ID, type BuiltinProfileId } from '../registry/profile-schema';
import { availableBackends, type ComputeBackend } from './compute';
import { nvidiaDriverTooOld, usableGpuApis } from './cuda';
import { versionParts } from './linux/parse-proc';
import { majorVersion } from './parse-mac';
import { tierRank, type GpuApi, type GpuInfo, type HardwareInfo, type HardwareTier } from './types';

/** In core's HARDWARE_SHORTFALLS order. */
export type HardwareShortfall =
  /** A Mac without Apple silicon. Raised on a Mac only. */
  | 'not_apple_silicon'
  | 'macos_too_old'
  /** Ubuntu before 22.04 (LNX1). Other Linux distributions and Windows aren't judged. */
  | 'os_too_old'
  | 'memory_low'
  | 'disk_low'
  /** No GPU backend for local models (Metal on an Apple GPU, CUDA, ROCm, DirectML, Vulkan). */
  | 'no_gpu_for_local_models'
  /** An NVIDIA driver older than CUDA 13 needs (580, cuda.ts): local models take Vulkan, WebGPU or the CPU. */
  | 'gpu_driver_old';

export interface ComputeSummary {
  /** Backends for model inference on this machine, accelerated first; 'cpu' is always last. */
  readonly backends: readonly ComputeBackend[];
  /** The primary GPU, for Settings → About. */
  readonly gpu?: GpuInfo;
  /** Memory the GPU can use: RAM with unified memory, else the discrete GPU's VRAM. */
  readonly gpuMemoryBytes: number;
  readonly neuralEngine: boolean;
  /** TAALCUT_FORCE_CPU (the probe's `forcedCpu`): a model's CPU choice says `disabled` (selectCompute). */
  readonly forcedCpu?: boolean;
}

export interface HardwareAssessment {
  readonly tier: HardwareTier;
  readonly shortfalls: readonly HardwareShortfall[];
  readonly defaultProfileId: BuiltinProfileId;
  readonly compute: ComputeSummary;
  /** i18n keys for Settings → About. */
  readonly labelKey: string;
  readonly shortfallKeys: readonly string[];
}

const GIB = 1024 ** 3;
export const TIER_RULES = {
  minMacosMajor: 14,
  minMemoryGiB: 8,
  minFreeDiskGiB: 20,
  recommendedMemoryGiB: 16,
  recommendedGpuMemoryGiB: 8,
  highMemoryGiB: 32,
  highGpuCores: 16,
  /** Off a Mac: VRAM for High (local vision beside speech and the embedder, the 32k window: 7.6 GB measured). */
  highGpuMemoryGiB: 12,
  /** Ubuntu's oldest supported release (LNX1: native builds target 22.04's glibc 2.35). */
  minUbuntu: '22.04',
} as const;

/** Every tier starts on Balanced (PRD 8.4); kept as a table so a tier can get its own default later. */
const DEFAULT_PROFILE: Readonly<Record<HardwareTier, BuiltinProfileId>> = {
  minimum: DEFAULT_PROFILE_ID,
  recommended: DEFAULT_PROFILE_ID,
  high: DEFAULT_PROFILE_ID,
};

/** Backends that run local language and vision models on a GPU. */
const LOCAL_MODEL_GPU_BACKENDS: ReadonlySet<ComputeBackend> = new Set([
  'metal',
  'mlx',
  'cuda',
  'rocm',
  'directml',
  'vulkan',
]);

/** Off a Mac: GPU APIs High needs (ONNX Runtime's embedder and OCR accelerate on them, not on Vulkan). */
const HIGH_TIER_APIS: ReadonlySet<GpuApi> = new Set(['cuda', 'rocm', 'directml']);
/** Off a Mac: GPU APIs Recommended's models (whisper.cpp, llama.cpp) run on. */
const RECOMMENDED_TIER_APIS: ReadonlySet<GpuApi> = new Set(['cuda', 'rocm', 'directml', 'vulkan']);

export function assessHardware(info: HardwareInfo): HardwareAssessment {
  const memoryGiB = info.memoryBytes / GIB;
  const compute = summarizeCompute(info);
  const shortfalls: HardwareShortfall[] = [];
  const mac = info.platform === 'darwin';
  const appleSilicon = info.arch === 'arm64' && info.appleChip !== undefined;
  if (mac && !appleSilicon) shortfalls.push('not_apple_silicon');
  if (mac && majorVersion(info.osVersion) < TIER_RULES.minMacosMajor) shortfalls.push('macos_too_old');
  if (ubuntuTooOld(info)) shortfalls.push('os_too_old');
  // Marketing "8 GB" is exactly 8 GiB; allow a little slack for reserved memory.
  if (memoryGiB < TIER_RULES.minMemoryGiB - 0.5) shortfalls.push('memory_low');
  if (info.freeDiskBytes < TIER_RULES.minFreeDiskGiB * GIB) shortfalls.push('disk_low');
  const localGpu = compute.backends.some((b) => LOCAL_MODEL_GPU_BACKENDS.has(b));
  if (!localGpu) shortfalls.push('no_gpu_for_local_models');
  if (info.gpus.some(nvidiaDriverTooOld)) shortfalls.push('gpu_driver_old');

  const tier = mac
    ? tierFor(appleSilicon && localGpu, memoryGiB, compute, info)
    : discreteGpuTier(info.gpus, memoryGiB);
  return {
    tier,
    shortfalls,
    defaultProfileId: DEFAULT_PROFILE[tier],
    compute,
    labelKey: `models.tier.${tier}.label`,
    shortfallKeys: shortfalls.map((s) => `models.hardware.${s}`),
  };
}

function summarizeCompute(info: HardwareInfo): ComputeSummary {
  const gpu = info.gpus[0];
  const gpuMemoryBytes = gpu?.unifiedMemory ? info.memoryBytes : (gpu?.vramBytes ?? 0);
  return {
    backends: availableBackends(info),
    ...(gpu ? { gpu } : {}),
    gpuMemoryBytes,
    neuralEngine: info.neuralEngine,
    ...(info.forcedCpu ? { forcedCpu: true } : {}),
  };
}

function tierFor(
  eligible: boolean,
  memoryGiB: number,
  compute: ComputeSummary,
  info: HardwareInfo,
): HardwareTier {
  const gpuMemoryGiB = compute.gpuMemoryBytes / GIB;
  if (
    !eligible ||
    memoryGiB < TIER_RULES.recommendedMemoryGiB - 0.5 ||
    gpuMemoryGiB < TIER_RULES.recommendedGpuMemoryGiB - 0.5
  )
    return 'minimum';
  const cores = compute.gpu?.cores ?? info.gpuCores;
  const strongGpu =
    cores !== undefined
      ? cores >= TIER_RULES.highGpuCores
      : info.appleChip?.variant === 'max' || info.appleChip?.variant === 'ultra';
  const high = memoryGiB >= TIER_RULES.highMemoryGiB - 0.5 && strongGpu && compute.neuralEngine;
  return high ? 'high' : 'recommended';
}

/** The best tier any one GPU earns off a Mac (its own APIs and VRAM, the machine's RAM). */
function discreteGpuTier(gpus: readonly GpuInfo[], memoryGiB: number): HardwareTier {
  const atLeast = (have: number, rule: number) => have >= rule - 0.5;
  let best: HardwareTier = 'minimum';
  for (const gpu of gpus) {
    const apis = usableGpuApis(gpu);
    const vramGiB = (gpu.vramBytes ?? 0) / GIB;
    const tier: HardwareTier =
      apis.some((api) => HIGH_TIER_APIS.has(api)) &&
      atLeast(memoryGiB, TIER_RULES.highMemoryGiB) &&
      atLeast(vramGiB, TIER_RULES.highGpuMemoryGiB)
        ? 'high'
        : apis.some((api) => RECOMMENDED_TIER_APIS.has(api)) &&
            atLeast(memoryGiB, TIER_RULES.recommendedMemoryGiB) &&
            atLeast(vramGiB, TIER_RULES.recommendedGpuMemoryGiB)
          ? 'recommended'
          : 'minimum';
    if (tierRank(tier) > tierRank(best)) best = tier;
  }
  return best;
}

/** Ubuntu (by its own name) before TIER_RULES.minUbuntu. Derivatives number their releases their own way. */
function ubuntuTooOld(info: HardwareInfo): boolean {
  if (info.platform !== 'linux' || !/^ubuntu\b/i.test(info.osName ?? '')) return false;
  const [major, minor] = versionParts(info.osVersion) ?? [];
  const [minMajor = 0, minMinor = 0] = versionParts(TIER_RULES.minUbuntu) ?? [];
  if (major === undefined || minor === undefined) return false;
  return major < minMajor || (major === minMajor && minor < minMinor);
}
