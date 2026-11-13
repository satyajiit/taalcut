// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hardware facts and tiers (G14, PRD 11; ADR 0002 GPU first). Detection is
 * OS-specific and sits behind HardwareProbe, so a platform adds an
 * implementation, not a rewrite. The GPU shape is platform-neutral: macOS
 * fills in Metal, Windows DirectML, Vulkan and CUDA, Linux Vulkan and CUDA
 * (LNX1). The probe reports facts; floors such as CUDA 13's driver and compute
 * capability are applied by whoever needs them (compute.ts, cuda.ts).
 */
import type { AsyncResult } from '@taalcut/core';

export const HARDWARE_TIERS = ['minimum', 'recommended', 'high'] as const;
export type HardwareTier = (typeof HARDWARE_TIERS)[number];

export function tierRank(tier: HardwareTier): number {
  return HARDWARE_TIERS.indexOf(tier);
}

export interface AppleChip {
  /** 1 for M1, 2 for M2, ... */
  readonly generation: number;
  readonly variant: 'base' | 'pro' | 'max' | 'ultra';
}

/** GPU programming interfaces a compute path can target. */
export const GPU_APIS = ['metal', 'cuda', 'rocm', 'directml', 'vulkan'] as const;
export type GpuApi = (typeof GPU_APIS)[number];

export type GpuVendor = 'apple' | 'amd' | 'intel' | 'nvidia' | 'other';

export interface GpuInfo {
  readonly name: string;
  readonly vendor: GpuVendor;
  readonly cores?: number;
  /** Dedicated video memory. Absent with unified memory, where the GPU uses system RAM. */
  readonly vramBytes?: number;
  /** Apple Silicon: the GPU addresses system memory directly. */
  readonly unifiedMemory: boolean;
  readonly apis: readonly GpuApi[];
  /** Highest Metal family macOS reports, e.g. 'metal3' or 'metal4'. */
  readonly metalFamily?: string;
  /** NVIDIA: as nvidia-smi prints it, e.g. '615.71.09'. AMD and Intel on Windows: the driver store version. */
  readonly driverVersion?: string;
  /** NVIDIA CUDA compute capability, e.g. '8.9'. */
  readonly computeCapability?: string;
  /** NVIDIA: nvidia-smi's index (PCI bus order). */
  readonly index?: number;
  /**
   * The ordinal CUDA gives this GPU in Taalcut's processes, after CUDA_VISIBLE_DEVICES: the `device_id` for ONNX
   * Runtime's CUDA provider and whisper.cpp. Set only with `cuda` in `apis`.
   */
  readonly cudaDeviceId?: number;
  /** PCI address, domain first, e.g. '0000:01:00.0'. */
  readonly pciBusId?: string;
  /** Video memory not in use when the probe ran (other apps and sessions hold the rest). */
  readonly vramFreeBytes?: number;
  /** Linux: the DRM render node, e.g. '/dev/dri/renderD129' (VA-API and Vulkan open it). */
  readonly renderNode?: string;
  /** Linux: the kernel driver bound to the GPU, e.g. 'nvidia', 'nouveau', 'i915', 'xe', 'amdgpu'. */
  readonly kernelDriver?: string;
}

export interface HardwareInfo {
  readonly platform: string;
  readonly arch: string;
  /** Marketing name, e.g. 'Apple M3 Max'. */
  readonly chip: string;
  /** Set on Apple Silicon. */
  readonly appleChip?: AppleChip;
  /** Model identifier, e.g. 'Mac15,9'. */
  readonly machineModel?: string;
  readonly memoryBytes: number;
  /** Cores of the primary GPU (gpus[0]), kept for callers that only need the count. */
  readonly gpuCores?: number;
  /** Primary GPU first: the integrated Apple GPU, else the discrete GPU with the most memory. */
  readonly gpus: readonly GpuInfo[];
  /** Apple's Neural Engine, which Core ML uses. Every Apple Silicon Mac has one. */
  readonly neuralEngine: boolean;
  readonly cpuCores: { readonly total: number; readonly performance?: number; readonly efficiency?: number };
  /** Free space on the volume that holds Taalcut's data. */
  readonly freeDiskBytes: number;
  /** e.g. '15.1' or '14.6.1'; Linux: os-release's VERSION_ID, e.g. '24.04'; Windows: '10.0.26100'. */
  readonly osVersion: string;
  /** The OS as it names itself, e.g. 'Ubuntu 24.04.5 LTS' or 'Microsoft Windows 11 Pro'. Absent on a Mac. */
  readonly osName?: string;
  /**
   * TAALCUT_FORCE_CPU=1 turned every GPU API off (the CPU-only gate path): the GPUs are still listed, with no
   * `apis`, and a CPU choice records the fallback reason `disabled` rather than a missing GPU.
   */
  readonly forcedCpu?: boolean;
}

export interface HardwareProbe {
  probe(options?: { readonly signal?: AbortSignal }): AsyncResult<HardwareInfo>;
}
