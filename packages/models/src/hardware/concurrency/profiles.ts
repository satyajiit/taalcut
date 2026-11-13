// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Concurrency profiles (round IX, design A): how many jobs of each hardware class a kind of machine runs
 * at once. The first profile that matches wins, so another kind of machine (a GPU vendor, a Windows NPU)
 * is a new entry here, not a branch in the planner. Apple rows come from the tier argument, so the bench's
 * forced tier gets that tier's row on any Mac; NVIDIA rows from the VRAM free when the probe ran; the CPU budget
 * of non-Apple machines from their performance cores. Machines without a Neural Engine run npu-class work (OCR)
 * on the GPU, so it folds into the gpu budget (LNX1, `NO_NPU_FOLD`). Starting points from design A;
 * packages/jobs/SPEC.md records the tuning.
 */
import type { JobConcurrencyPlan, ResourceClass } from '@taalcut/core';
import type { HardwareInfo, HardwareTier } from '../types';
import type { ModelLane } from './model-lanes';

export interface PlanMachine {
  readonly info: HardwareInfo;
  /** The assessed tier, or the bench's forced one: Apple rows follow it, never the raw facts. */
  readonly tier: HardwareTier;
}

/** Budgets of the classes that depend on the machine; io and network are the same everywhere. */
export type DeviceBudgets = Readonly<Record<Exclude<ResourceClass, 'io' | 'network'>, number>>;

/** Lanes that run more than `MODEL_LANE_LIMITS`' one job at once on a kind of machine. */
export type LaneLimits = Readonly<Partial<Record<ModelLane, number>>>;

export const CONCURRENCY_PROFILE_IDS = ['apple-silicon', 'nvidia', 'other-gpu', 'no-accelerator'] as const;
export type ConcurrencyProfileId = (typeof CONCURRENCY_PROFILE_IDS)[number];

export interface ConcurrencyProfile {
  readonly id: ConcurrencyProfileId;
  readonly matches: (machine: PlanMachine) => boolean;
  readonly budgets: (machine: PlanMachine) => DeviceBudgets;
  /** Lane limits over `MODEL_LANE_LIMITS` (absent: one job per lane). */
  readonly lanes?: (machine: PlanMachine) => LaneLimits;
  /** Classes that draw on another class's budget here (core's `JobConcurrencyPlan.foldInto`). */
  readonly foldInto?: JobConcurrencyPlan['foldInto'];
}

const GIB = 1024 ** 3;

/**
 * Design A's Apple rows. Minimum is today's behaviour (models alternate, memory first). The npu class holds the
 * Neural Engine lanes: Parakeet and, from design H, on-screen text (`vision.ocr`). From recommended up OCR runs
 * two files at once (`APPLE_TIER_LANES`, IX3-O2) and Parakeet keeps its own slot beside them, so the class is
 * three; Apple Vision itself still reads at most two requests at once (the mac helper's OCR slots). At minimum
 * they take turns.
 */
export const APPLE_TIER_BUDGETS: Readonly<Record<HardwareTier, DeviceBudgets>> = {
  minimum: { cpu: 2, video: 2, gpu: 1, npu: 1 },
  /** EmbeddingGemma and whisper side by side; two OCR files and Parakeet side by side. */
  recommended: { cpu: 3, video: 2, gpu: 2, npu: 3 },
  /**
   * EmbeddingGemma, speech recognition and the local vision model side by side. Video stays at 2, not
   * design A's 3: VideoToolbox's encoder stalled twice on 2026-10-17 and the Mac reset
   * (`_orch/ix/logs/bench/vt-hang-2.md`), so Macs keep today's video budget; the session cap stays the hard
   * limit either way.
   */
  high: { cpu: 4, video: 2, gpu: 3, npu: 3 },
};

/**
 * On-screen text two files at a time from recommended up (IX3-O2): one OCR job alone leaves the helper's two
 * Vision slots idle while it reads its frames, writes its BMPs, waits on its last short request or runs PP-OCR
 * for Hindi; a second job fills them (packages/vision SPEC, "On-screen text's share of the path"). Minimum keeps
 * one (memory first).
 */
export const APPLE_TIER_LANES: Readonly<Record<HardwareTier, LaneLimits>> = {
  minimum: {},
  recommended: { 'vision.ocr': 2 },
  high: { 'vision.ocr': 2 },
};

/**
 * Design A's NVIDIA rows by VRAM: NVDEC/NVENC sessions and VRAM bound video and GPU work. The VRAM is what was free
 * when the probe ran (LNX1): on a shared machine other apps' and sessions' models already hold part of the card.
 */
export const NVIDIA_VRAM_BUDGETS = [
  { minVramGiB: 12, video: 3, gpu: 3 },
  { minVramGiB: 8, video: 2, gpu: 2 },
  { minVramGiB: 0, video: 2, gpu: 1 },
] as const;

const primaryGpu = (info: HardwareInfo) => info.gpus[0];

/** VRAM Taalcut can plan on: the free part when the probe measured it, else the whole card. */
export function plannableVramBytes(info: HardwareInfo): number {
  const gpu = primaryGpu(info);
  return gpu?.vramFreeBytes ?? gpu?.vramBytes ?? 0;
}

/**
 * No Neural Engine (LNX1): OCR's npu-class jobs run on the same GPU as the embedder and speech (CUDA, DirectML,
 * Vulkan or, without one, the CPU), so they share the gpu budget rather than count that GPU twice.
 */
export const NO_NPU_FOLD = { npu: 'gpu' } as const satisfies JobConcurrencyPlan['foldInto'];

/** One CPU-class job per four performance cores (all cores when the probe can't tell), at least one. */
export function cpuBudget(info: HardwareInfo): number {
  const cores = info.cpuCores.performance ?? info.cpuCores.total;
  return Math.min(64, Math.max(1, Math.floor(cores / 4)));
}

/**
 * Neural Engine class work off Apple Silicon: one slot, for on-screen text (design H: PP-OCR through ONNX
 * Runtime on CUDA, DirectML or the CPU; Apple Vision on Intel Macs). Parakeet isn't offered on these machines, so
 * the slot is OCR's. Design A had 0 here, before OCR became its own stage.
 */
export const OFF_APPLE_NPU_BUDGET = 1;

export const CONCURRENCY_PROFILES: readonly ConcurrencyProfile[] = [
  {
    id: 'apple-silicon',
    matches: ({ info }) => info.appleChip !== undefined && primaryGpu(info)?.vendor === 'apple',
    budgets: ({ tier }) => APPLE_TIER_BUDGETS[tier],
    lanes: ({ tier }) => APPLE_TIER_LANES[tier],
  },
  {
    // A forced-CPU machine (no APIs) falls through to no-accelerator.
    id: 'nvidia',
    matches: ({ info }) => primaryGpu(info)?.vendor === 'nvidia' && (primaryGpu(info)?.apis.length ?? 0) > 0,
    budgets: ({ info }) => {
      const vramGiB = plannableVramBytes(info) / GIB;
      const row = NVIDIA_VRAM_BUDGETS.find((r) => vramGiB >= r.minVramGiB - 0.5) ?? NVIDIA_VRAM_BUDGETS[2];
      return { cpu: cpuBudget(info), video: row.video, gpu: row.gpu, npu: OFF_APPLE_NPU_BUDGET };
    },
    foldInto: NO_NPU_FOLD,
  },
  {
    // AMD and Intel GPUs on Windows and Linux, Intel Macs: one GPU job at a time.
    id: 'other-gpu',
    matches: ({ info }) => (primaryGpu(info)?.apis.length ?? 0) > 0,
    budgets: ({ info }) => ({ cpu: cpuBudget(info), video: 2, gpu: 1, npu: OFF_APPLE_NPU_BUDGET }),
    foldInto: NO_NPU_FOLD,
  },
  {
    // Every model on the CPU: each such fallback is logged where it is chosen (selectBackend).
    id: 'no-accelerator',
    matches: () => true,
    budgets: ({ info }) => ({ cpu: cpuBudget(info), video: 1, gpu: 1, npu: OFF_APPLE_NPU_BUDGET }),
    foldInto: NO_NPU_FOLD,
  },
];
