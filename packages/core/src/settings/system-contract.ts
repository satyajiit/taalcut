// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.system (Settings → About), served by the jobs process: models'
 * HardwareProbe + assessHardware (P1-E4), the component manager's list
 * (P1-E3) and the download of everything this machine needs (UX2-DOWNLOADER,
 * component-schema.ts), and which GPU backend each local module runs on
 * (ADR 0002, GPU first).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ipc } from '../ipc/contract';
import { componentSchema, downloadsSchema } from './component-schema';
import { HARDWARE_TIERS, MODEL_COMPUTE_BACKENDS, moduleIdSchema } from './models-contract';

/**
 * models' HardwareShortfall. not_apple_silicon and macos_too_old are raised on
 * a Mac only; os_too_old and gpu_driver_old on Linux and Windows (LNX1).
 */
export const HARDWARE_SHORTFALLS = [
  'not_apple_silicon',
  'macos_too_old',
  'os_too_old',
  'memory_low',
  'disk_low',
  'no_gpu_for_local_models',
  /** The GPU's driver is older than the GPU runtimes Taalcut ships need, e.g. NVIDIA below 580 for CUDA 13. */
  'gpu_driver_old',
] as const;
export type HardwareShortfall = (typeof HARDWARE_SHORTFALLS)[number];

/** GPU programming interfaces, as models' GPU_APIS. */
export const GPU_APIS = ['metal', 'cuda', 'rocm', 'directml', 'vulkan'] as const;
export const GPU_VENDORS = ['apple', 'amd', 'intel', 'nvidia', 'other'] as const;

/** One GPU the probe found, as the UI shows it: 'NVIDIA GeForce RTX 4090 · 24 GB · CUDA'. */
export const gpuSummarySchema = z.object({
  name: z.string(),
  vendor: z.enum(GPU_VENDORS),
  /** Dedicated video memory. Absent with unified memory. */
  vramBytes: z.number().nonnegative().optional(),
  /** As the vendor's tool prints it, e.g. '615.71.09'. */
  driverVersion: z.string().optional(),
  apis: z.array(z.enum(GPU_APIS)),
});
export type GpuSummary = z.infer<typeof gpuSummarySchema>;

/** models' HardwareInfo, with a summary of each GPU. */
export const hardwareInfoSchema = z.object({
  platform: z.string(),
  arch: z.string(),
  /** Marketing name, e.g. 'Apple M3 Max'. */
  chip: z.string(),
  machineModel: z.string().optional(),
  memoryBytes: z.number().nonnegative(),
  gpuCores: z.int().positive().optional(),
  cpuCores: z.object({
    total: z.int().positive(),
    performance: z.int().nonnegative().optional(),
    efficiency: z.int().nonnegative().optional(),
  }),
  freeDiskBytes: z.number().nonnegative(),
  osVersion: z.string(),
  /** The OS as it names itself, e.g. 'Ubuntu 24.04.5 LTS'. Absent on a Mac, where the UI says macOS. */
  osName: z.string().optional(),
  /** Primary GPU first. Absent from a report made before LNX1. */
  gpus: z.array(gpuSummarySchema).optional(),
});

/**
 * What an NVIDIA GPU still needs before Taalcut's CUDA builds can use it (LNX1-TRM), from the probe and the CUDA
 * runtime component, worst first: no NVIDIA driver loaded (nouveau, or nvidia-smi absent); a driver older than
 * CUDA 13 needs; a GPU older than CUDA 13 supports; NVIDIA's CUDA libraries not installed (or their terms not
 * accepted); installed but damaged; installed since the app started (used from its next start); ready.
 */
export const GPU_SETUP_STATES = [
  'no_driver',
  'driver_old',
  'gpu_too_old',
  'runtime_missing',
  'runtime_damaged',
  'restart_needed',
  'ready',
] as const;
export type GpuSetupState = (typeof GPU_SETUP_STATES)[number];

/** models' nvidiaGpuSetup: the NVIDIA GPU the CUDA builds would run on, and what it still needs. */
export const gpuSetupSchema = z.object({
  state: z.enum(GPU_SETUP_STATES),
  /** As the probe names it, e.g. 'NVIDIA GeForce RTX 4090'. Shown as is. */
  gpuName: z.string(),
  /** As nvidia-smi prints it, e.g. '550.120'. Absent without NVIDIA's driver. */
  driverVersion: z.string().optional(),
  /** The oldest driver CUDA 13 runs on, as NVIDIA numbers it: '580'. */
  minDriver: z.string(),
  /** e.g. '6.1'. Absent without NVIDIA's driver. */
  computeCapability: z.string().optional(),
  /** CUDA 13's oldest: '7.5' (Turing). */
  minComputeCapability: z.string(),
  /** The kernel driver bound to it, e.g. 'nouveau'; absent when none is. */
  kernelDriver: z.string().optional(),
  /** NVIDIA's terms for the CUDA libraries are accepted (with runtime_missing: what is left is the download). */
  termsAccepted: z.boolean(),
});
export type GpuSetup = z.infer<typeof gpuSetupSchema>;

/** models' HardwareAssessment plus the probe result it came from. */
export const hardwareReportSchema = z.object({
  info: hardwareInfoSchema,
  tier: z.enum(HARDWARE_TIERS),
  shortfalls: z.array(z.enum(HARDWARE_SHORTFALLS)),
  labelKey: z.string(),
  shortfallKeys: z.array(z.string()),
  /** An NVIDIA GPU on a platform Taalcut ships a CUDA runtime for (LNX1-TRM); absent elsewhere. */
  gpuSetup: gpuSetupSchema.optional(),
});
export type HardwareReport = z.infer<typeof hardwareReportSchema>;

export const computeReportSchema = z.object({
  /** The GPU Taalcut uses. Absent when the probe couldn't tell. */
  gpu: z
    .object({
      /** e.g. 'Apple M2 Pro'. Shown as is. */
      name: z.string(),
      cores: z.int().positive().optional(),
      /** Graphics API and version, e.g. 'Metal 3'. Shown as is. */
      api: z.string().optional(),
      /** Dedicated video memory. Absent with unified memory. */
      vramBytes: z.number().nonnegative().optional(),
      /** e.g. '615.71.09'. Shown as is. */
      driverVersion: z.string().optional(),
    })
    .optional(),
  /** Each module that runs on this machine, and on what. Empty when nothing runs locally yet. */
  modules: z.array(
    z.object({
      module: moduleIdSchema,
      /** Product name of the runtime, e.g. 'MLX', 'ONNX Runtime'. Shown as is. */
      runtime: z.string(),
      backend: z.enum(MODEL_COMPUTE_BACKENDS),
      /** For 'cpu': the logged reason, one of CPU_FALLBACK_REASON_KEYS. */
      fallbackReasonKey: z.string().optional(),
    }),
  ),
});
export type ComputeReport = z.infer<typeof computeReportSchema>;

export const systemContract = {
  /** Probes once and caches; a failed probe is models.hardware_probe_failed (retryable). */
  hardware: ipc.output(hardwareReportSchema),
  components: ipc.output(z.array(componentSchema)),
  /** UX2-DOWNLOADER: the download of everything this machine needs; the `components.downloads` event follows it. */
  downloads: ipc.output(downloadsSchema),
  compute: ipc.output(computeReportSchema),
};
