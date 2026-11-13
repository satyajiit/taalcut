// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MLX1: Qwen3.5 9B on MLX for Apple silicon Macs of the High tier, served by Taalcut's own MLX server
 * (native/mlx-server, mlx-server.ts), and the spec each machine runs (`localRuntimeSpec`):
 *
 * - an Apple silicon Mac (darwin-arm64): the 9B on MLX first, from the High tier up, then llama.cpp's models as
 *   before. A High Mac keeps the 4B too: the components manifest's tiers can't differ by platform, and it is what
 *   serves while the 9B downloads, when the GPU is turned off (TAALCUT_FORCE_CPU), when the MLX server can't
 *   start, and whenever a call asks for it by name;
 * - anything else (Linux, Intel Macs, other GPUs): llama.cpp's spec unchanged.
 *
 * The 9B's window is the largest measured one whose peak, beside the embedder, fits the tier's budget
 * (localModelBudgetBytes, as for llama.cpp's models). Measured in `_orch/mlx1/eval/footprint/` (footprint-9b.py).
 */
import type { ComputeBackend } from '../hardware/compute';
import type { HardwareTier } from '../hardware/types';
import { compactToolsTemplate } from './chat-templates/chat-template';
import { QWEN3_5_4B_CHAT_TEMPLATE } from './chat-templates/qwen3-5-4b';
import {
  LLAMA_CPP_MODELS,
  LLAMA_CPP_RUNTIME_NAME,
  llamaCppRuntimeSpec,
  localModelBudgetBytes,
  MEASURED_EMBEDDER_BYTES,
  SMALLEST_LOCAL_WINDOW,
} from './llama-cpp-spec';
import type { LocalRuntimeModel, LocalRuntimeSpec } from './types';

/** The MLX server's component (native/mlx-server/build.sh --tarball) and its version. */
export const MLX_RUNTIME_COMPONENT = 'local-llm-runtime-mlx';
export const MLX_RUNTIME_NAME = 'MLX (mlx-swift-lm 3.32.3)';

/** MLX runs on Apple GPUs only (compute.ts offers 'mlx' only there). */
export const MLX_COMPUTE: readonly ComputeBackend[] = ['mlx'];

/** The models the MLX server serves, biggest first; the window is the tier's (`mlxWindowFor`). */
export const MLX_MODELS: readonly Omit<LocalRuntimeModel, 'contextWindow'>[] = [
  {
    id: 'qwen3.5-9b',
    name: 'Qwen3.5 9B',
    // mlx-community/Qwen3.5-9B-4bit (Apache-2.0): the weights, the vision tower, the tokenizer and the config in one
    // folder.
    componentId: 'local-llm-qwen3-5-9b-mlx',
    minTier: 'high',
    vision: true,
    reasoning: true,
    thinkingKwarg: 'enable_thinking',
    // Its folder's chat_template.jinja is the 4B's GGUF template byte for byte (same sha256,
    // test/chat-templates.test.ts), with the tools written compact as for llama.cpp.
    chatTemplate: compactToolsTemplate(QWEN3_5_4B_CHAT_TEMPLATE),
    compute: MLX_COMPUTE,
    engine: 'mlx',
    runtimeComponentId: MLX_RUNTIME_COMPONENT,
  },
];

/** Every model the embedded runtime can serve, on any engine. */
export const LOCAL_RUNTIME_MODELS: readonly Omit<LocalRuntimeModel, 'contextWindow'>[] = [
  ...MLX_MODELS,
  ...LLAMA_CPP_MODELS,
];

/**
 * Peak memory (bytes) of taalcut-mlx-server serving the 9B, filled to each window (a text prompt to the window less
 * 512 tokens, then a 1080×1920 frame with text to the same length), each window in a fresh process: the larger of
 * the physical footprint and the RSS (MLX's buffers are in the footprint, not the RSS). Measured 2026-10-31 on an
 * M5 Max (64 GB, macOS 27.2), sampled every 250 ms: `_orch/mlx1/eval/footprint/mlx.json`.
 */
export const MLX_MEASURED_PEAK_BYTES: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  // Loaded and idle: 6.29 GiB footprint, 5.74 GiB RSS. With the embedder (MEASURED_EMBEDDER_BYTES) the High tier's
  // 12.588 GiB holds 32,768 (12.429 GiB).
  'qwen3.5-9b': {
    8_192: 8_980_289_056,
    12_288: 9_246_758_480,
    16_384: 9_619_133_960,
    24_576: 10_650_424_936,
    32_768: 11_213_149_896,
  },
};

/** The largest measured window whose peak, beside the embedder, fits the tier's budget; else the smallest window. */
export function mlxWindowFor(model: string, tier: HardwareTier): number {
  const budget = localModelBudgetBytes(tier);
  const fits = Object.entries(MLX_MEASURED_PEAK_BYTES[model] ?? {})
    .filter(([, peak]) => peak + MEASURED_EMBEDDER_BYTES <= budget)
    .map(([window]) => Number(window));
  return Math.max(SMALLEST_LOCAL_WINDOW, ...fits);
}

/** `${process.platform}-${process.arch}`, the way the components manifest names platforms. */
export const currentPlatform = (): string => `${process.platform}-${process.arch}`;

/** The runtime as this machine runs it at `tier`; see the module comment. */
export function localRuntimeSpec(tier: HardwareTier, platform: string = currentPlatform()): LocalRuntimeSpec {
  const llama = llamaCppRuntimeSpec(tier);
  if (platform !== 'darwin-arm64') return llama;
  return {
    ...llama,
    name: `${MLX_RUNTIME_NAME}, ${LLAMA_CPP_RUNTIME_NAME}`,
    models: [
      ...MLX_MODELS.map((model) => ({ ...model, contextWindow: mlxWindowFor(model.id, tier) })),
      ...llama.models,
    ],
  };
}
