// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the embedder runs on this machine (IX-E2, E3, E4, E6), a pure function
 * of the hardware facts: the soft-token budget per frame, the execution
 * providers to try in order, how many image tokens one model call takes, and
 * whether the model loads as soon as an import starts. The model, its
 * weights and the frame budget are the same everywhere (one space, one
 * geometry), so a library moved between Macs stays searchable and the
 * distance thresholds stay meaningful.
 *
 * Token budget: 280 soft tokens per frame (the processor's own) on every tier.
 * The budget study (vision SPEC "Indexing speed: the embedder") found 140
 * tokens 2.2–2.8× faster with the same search hit@5, but it compresses the
 * distances between frames (cut pairs on the ix-v1 footage measured ×0.78 at
 * the median, a real cut fell under `shots.minDistance` and was lost), and
 * shot cuts, soft cuts and near-duplicates are thresholded on distances fitted
 * at 280. A per-tier budget waits for those thresholds to be fitted per
 * budget on labelled footage; the profile keeps the field for it.
 *
 * Execution providers by platform, from onnxruntime-node 1.30.0's prebuilt
 * bindings (its README's "EPs/Platforms" table, also in transformers.js
 * 4.3.1's backends/onnx.js): macOS arm64 has CPU, WebGPU and Core ML; Windows
 * x64/arm64 CPU, WebGPU and DirectML (no CUDA: the CUDA EP ships for Linux
 * x64 only); Linux x64 CPU, WebGPU and CUDA 13. The probe's accelerators
 * (LNX1, `MachineAccelerators`) drop what this machine can't run: CUDA below
 * CUDA 13's driver or compute capability, WebGPU without Metal, Vulkan or
 * Direct3D 12, every GPU when TAALCUT_FORCE_CPU is set (the CPU then records
 * `disabled`). The CUDA session takes the probe's device id. The embedder
 * tries only the providers the loaded runtime lists, so CUDA on Windows is
 * used only once a CUDA build of ONNX Runtime ships as a component (post-v1).
 *
 * Core ML first on macOS 15 and later (IX2-E3, E5): not ONNX Runtime's Core
 * ML provider (IX-E3 measured the q4 graph unable to run on it, the vision
 * encoder alone at 1.0 frames/s and 11 GB), but the mac helper's embed
 * service over the `embeddinggemma-2-coreml` component, the same q4 weights
 * compiled for Core ML (multifunction models need macOS 15): vision on the
 * GPU, text on the Neural Engine, vectors at cosine ≥ 0.999 to WebGPU's. On
 * macOS 14, or until the component is installed and compiled for this Mac,
 * ONNX Runtime on WebGPU.
 */
import { usableDevices, type MachineAccelerators } from '@taalcut/media';
import type { Tier } from '../config';
import type { EmbeddingDevice } from './model';
import { EMBEDDING_COREML_MIN_MACOS, type ImageTokenBudget } from './space';

/** The hardware facts the profile reads (a slice of models' HardwareInfo, plus the tier). */
export interface EmbeddingHardware {
  readonly platform: string;
  /** macOS's `sw_vers -productVersion` ("15.4.1"); absent when unknown. */
  readonly osVersion?: string;
  readonly tier: Tier;
  readonly memoryBytes: number;
  readonly gpus: readonly {
    readonly vendor: string;
    readonly vramBytes?: number;
  }[];
  /** What the probe found the machine can run; absent: the platform's row as it is. */
  readonly accelerators?: MachineAccelerators;
}

export interface EmbeddingProfile {
  /** Soft tokens per frame (the image processor's budget). */
  readonly imageTokens: ImageTokenBudget;
  /** Execution providers in order of preference, accelerated first, the CPU last. */
  readonly devices: readonly EmbeddingDevice[];
  /** Image soft tokens one model call takes at most (at least one frame per call). */
  readonly batchTokens: number;
  /** Frames one call takes at most, whatever their tokens (bounds the padded patch tensor). */
  readonly maxBatchFrames: number;
  /** Texts per model call. */
  readonly textBatch: number;
  /** Load the model when an import starts, off the critical path (IX-E4). */
  readonly warmOnImport: boolean;
  /** The CUDA session's device (the probe's CUDA ordinal). */
  readonly cudaDeviceId?: number;
  /** TAALCUT_FORCE_CPU: the CPU, with `disabled`. */
  readonly forcedCpu?: boolean;
}

const GIB = 1024 ** 3;

/**
 * Soft tokens per indexed frame, by tier (IX2-E1, vision SPEC "Indexing speed round 2"). 140 on every tier: search
 * hit@5 as at 280, duplicates as good with their 140 thresholds, and 4× the frames per second of 280 on Core ML. Shot
 * detection's and the breakdown's frames stay at CALIBRATED_IMAGE_TOKENS (280) whatever this says.
 */
const IMAGE_TOKENS: Readonly<Record<Tier, ImageTokenBudget>> = {
  minimum: 140,
  recommended: 140,
  high: 140,
};

/**
 * Image tokens per call on Apple GPUs. Measured on this M5 Max (`bench:embed
 * --batch-tokens`, 5 runs each, vision SPEC): at 280-token frames one, two or
 * four frames per call ran at the same rate (q4f16 5.07, 4.91 and 5.20
 * frames/s; q4 2.77, 2.83, 2.78), so calls stay one frame long and a search
 * query waits behind at most one frame (about 0.2 s). Smaller budgets fill a
 * call with more frames (four at 140).
 */
const APPLE_BATCH_TOKENS = 512;
/** Discrete GPUs with their own memory: an estimate (not run on real hardware), twice the Apple value. */
const DISCRETE_BATCH_TOKENS = 1024;

/** Whether any of the machine's GPUs matches. */
const anyGpu = (hw: EmbeddingHardware, test: (gpu: EmbeddingHardware['gpus'][number]) => boolean) =>
  hw.gpus.some(test);
const isNvidia = (gpu: EmbeddingHardware['gpus'][number]) => gpu.vendor === 'nvidia';
/** A GPU with memory of its own (not unified with the system's). */
const isDiscrete = (gpu: EmbeddingHardware['gpus'][number]) => (gpu.vramBytes ?? 0) > 0;

/** macOS's major version, or 0 when unknown. */
export function macosMajor(version: string | undefined): number {
  const major = Number.parseInt(version ?? '', 10);
  return Number.isFinite(major) ? major : 0;
}

/** Devices per platform; a platform not listed gets WebGPU, then the CPU. */
const PLATFORM_DEVICES: Readonly<Record<string, (hw: EmbeddingHardware) => readonly EmbeddingDevice[]>> = {
  darwin: (hw) =>
    macosMajor(hw.osVersion) >= EMBEDDING_COREML_MIN_MACOS ? ['coreml', 'webgpu', 'cpu'] : ['webgpu', 'cpu'],
  win32: (hw) =>
    anyGpu(hw, isNvidia) ? ['cuda', 'directml', 'webgpu', 'cpu'] : ['directml', 'webgpu', 'cpu'],
  linux: (hw) => (anyGpu(hw, isNvidia) ? ['cuda', 'webgpu', 'cpu'] : ['webgpu', 'cpu']),
};

export function embeddingProfile(hw: EmbeddingHardware): EmbeddingProfile {
  const rows = PLATFORM_DEVICES[hw.platform]?.(hw) ?? ['webgpu', 'cpu'];
  const devices = usableDevices(rows, hw.accelerators);
  const cudaDeviceId = hw.accelerators?.cudaDeviceId;
  return {
    imageTokens: IMAGE_TOKENS[hw.tier],
    devices,
    batchTokens: anyGpu(hw, isDiscrete) ? DISCRETE_BATCH_TOKENS : APPLE_BATCH_TOKENS,
    maxBatchFrames: 16,
    textBatch: 16,
    // The model takes about 1.2 GiB resident; on an 8 GB Mac it loads only when a frame needs it.
    warmOnImport: hw.tier !== 'minimum' && hw.memoryBytes >= 12 * GIB,
    ...(devices.includes('cuda') && cudaDeviceId !== undefined ? { cudaDeviceId } : {}),
    ...(hw.accelerators?.forcedCpu ? { forcedCpu: true } : {}),
  };
}

/** When the hardware can't be read (and in tests): the Minimum tier's budget, loading on first use. */
export const DEFAULT_EMBEDDING_PROFILE: EmbeddingProfile = {
  imageTokens: IMAGE_TOKENS.minimum,
  devices: ['webgpu', 'cpu'],
  batchTokens: APPLE_BATCH_TOKENS,
  maxBatchFrames: 16,
  textBatch: 16,
  warmOnImport: false,
};
