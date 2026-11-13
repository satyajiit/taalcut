// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PROVISIONAL (spike 08, docs/spikes/08-local-inference-runtime.md). The
 * embedded runtime is a llama.cpp `llama-server` sidecar, tag b11571, serving
 * Qwen3.5 4B (Q4_K_M GGUF plus its BF16 vision projector) on Metal from the
 * Recommended tier up, and Qwen3.5 0.8B (Q4_K_M, text only) on the Minimum
 * tier (8 GB; J8b re-run, section 9). No M1 was booted: the 0.8B's M1 speed is
 * an estimate. Component ids match
 * tools/components/manifest.local-llm.provisional.json.
 *
 * Context windows by tier (LRN1-CTX, SPEC "Context windows by tier") are
 * computed from measured footprints: each tier gets the largest measured
 * window whose peak memory, beside the embedder, stays within the tier's
 * budget. The KV cache is q8_0 (follow-ups 4), part of what was measured.
 */
import type { ComputeBackend } from '../hardware/compute';
import { TIER_RULES } from '../hardware/tiers';
import type { HardwareTier } from '../hardware/types';
import { compactToolsTemplate } from './chat-templates/chat-template';
import { QWEN3_5_0_8B_CHAT_TEMPLATE } from './chat-templates/qwen3-5-0-8b';
import { QWEN3_5_4B_CHAT_TEMPLATE } from './chat-templates/qwen3-5-4b';
import type { LocalRuntimeModel, LocalRuntimeSpec } from './types';

/** llama.cpp's backends, GPU first: Metal on macOS, CUDA or Vulkan elsewhere, then the CPU (ADR 0002). */
export const LLAMA_CPP_COMPUTE: readonly ComputeBackend[] = ['metal', 'cuda', 'vulkan', 'cpu'];

export const LLAMA_CPP_RUNTIME_NAME = 'llama.cpp b11571';

/**
 * llama.cpp's GPU builds by backend (LNX1; components manifest.linux.provisional.json): upstream's `ubuntu-cuda-13.4-x64` and
 * `ubuntu-vulkan-x64` archives of b11571. Each loads its GPU backend and the CPU's, so it also runs `--device none`.
 */
export const LLAMA_CPP_BUILDS: Readonly<Partial<Record<ComputeBackend, string>>> = {
  cuda: 'local-llm-runtime-cuda',
  vulkan: 'local-llm-runtime-vulkan',
};

/** The models the runtime serves, biggest first; the window is the tier's (`llamaCppRuntimeSpec`). */
export const LLAMA_CPP_MODELS: readonly Omit<LocalRuntimeModel, 'contextWindow'>[] = [
  {
    id: 'qwen3.5-4b',
    name: 'Qwen3.5 4B',
    componentId: 'local-llm-qwen3-5-4b',
    // One checkpoint for text and frames: the same process loads the projector (spike 08, section 4).
    projectorComponentId: 'local-llm-qwen3-5-4b-mmproj',
    // 2.7–5.0 GiB resident: nothing an 8 GB Mac can spare beside a video graph (spike 08, section 6).
    minTier: 'recommended',
    vision: true,
    // Hybrid thinking model; the profiles run it with thinking off, sent as enable_thinking: false.
    reasoning: true,
    thinkingKwarg: 'enable_thinking',
    // Its own template, the tools written compact (SPEC "Chat templates").
    chatTemplate: compactToolsTemplate(QWEN3_5_4B_CHAT_TEMPLATE),
    compute: LLAMA_CPP_COMPUTE,
  },
  {
    id: 'qwen3.5-0.8b',
    name: 'Qwen3.5 0.8B',
    componentId: 'local-llm-qwen3-5-0-8b',
    // 0.957 GiB resident on llama-server and 18/20 tool calls; about 23 tok/s estimated on an M1 (J8b).
    minTier: 'minimum',
    // Bigger Macs get the 4B above instead, so they don't download these weights too.
    maxTier: 'minimum',
    // Text only: J8b ran it without a projector, so frames go to the next model in the vision chain.
    vision: false,
    reasoning: true,
    thinkingKwarg: 'enable_thinking',
    chatTemplate: compactToolsTemplate(QWEN3_5_0_8B_CHAT_TEMPLATE),
    compute: LLAMA_CPP_COMPUTE,
  },
];

/**
 * The KV cache type the sidecar runs, for K and for V (`--cache-type-k`, `--cache-type-v`): q8_0 stores the cache in
 * about 53% of f16's bytes, and the measured footprints below are taken with it. A quantized V cache needs flash
 * attention, so `llamaServerArgs` turns it on on every backend.
 */
export const KV_CACHE_TYPE = 'q8_0';

/** The smallest window a tier gets (and the smallest measured for the 4B). */
export const SMALLEST_LOCAL_WINDOW = 8_192;

/**
 * Peak resident memory (RSS, bytes) of llama-server b11571, as the sidecar runs it (`llamaServerArgs`: one slot, every
 * layer on Metal, flash attention on, the KV cache at KV_CACHE_TYPE), filled to each window (a text prompt to the
 * window less 512 tokens; for the 4B also a 1080×1920 frame with text to the same length), with the embedder loaded
 * and busy beside it. Measured 2026-10-27 on an M5 Max (64 GB, macOS 26), sampled every 250 ms, each model, window and
 * cache type in a fresh process: `_orch/lrn1/logs/ctx/kv/` (footprint-kv.py). RSS is the larger measure here (it holds
 * the mapped weights); spike 08 measured the same way. Windows that aren't powers of two are measured too.
 */
export const MEASURED_PEAK_BYTES: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  // With its BF16 projector.
  'qwen3.5-4b': {
    8_192: 4_428_595_200,
    12_288: 4_576_444_416,
    16_384: 4_721_688_576,
    24_576: 5_159_223_296,
    32_768: 5_460_639_744,
  },
  'qwen3.5-0.8b': { 16_384: 956_596_224, 24_576: 1_028_767_744, 32_768: 1_098_055_680 },
};

/**
 * The embedder's peak in the same run: EmbeddingGemma 2 on Core ML in the mac helper plus the process hosting it,
 * embedding batches of eight 1080×1920 frames at the index budget. Physical footprint, the larger measure for it
 * (its Core ML memory isn't in RSS; RSS peaked at 1,952,759,808 bytes).
 */
export const MEASURED_EMBEDDER_BYTES = 2_132_737_712;

/**
 * What spike 08 decided a 16 GB Mac may give its resident local models: the 4B with its projector at 8,192 as it ran
 * then, with an f16 KV cache, beside the embedder. The sidecar's peak in that configuration, measured in the same run
 * as MEASURED_PEAK_BYTES. The decision is these bytes, not the window: the q8_0 cache holds a larger window in them.
 */
export const RECOMMENDED_SHARE_SIDECAR_BYTES = 4_625_465_344;

/**
 * AGT1: llama-server's host prompt cache by tier (`--cache-ram`, MiB). With one slot, a vision call between two agent
 * turns replaces the agent's prompt in the KV cache; the host cache keeps it in RAM and gives it back. b11571 keeps up
 * to 8 GiB by default, and the 4B's server reached 13.3 GiB RSS (MLX1: 9 to 10.5 in the app). Measured on the
 * recorded make flow's 68 agent requests, each after a strip described (`_orch/agt1/eval/cache/`, cache-bench.py),
 * the agent's request after a vision call at 32,768 tokens took 3.45 s (median) with none, 4.0 s at 512 MiB (too
 * small to hold the agent's prompt: 11k tokens reused of 513k), 0.45 s at 1 GiB, 0.44 s at 2 GiB, 0.43 s at 4 GiB
 * and 0.37 s uncapped: 1 GiB is the smallest cap that keeps the reuse. High takes it; Recommended has no room for
 * any (its 4B already peaks within 0.3 GiB of its share at 12,288, and 1 GiB added 3.0 GiB of RSS), nor Minimum.
 */
export const HOST_PROMPT_CACHE_MIB: Readonly<Record<HardwareTier, number>> = {
  minimum: 0,
  recommended: 0,
  high: 1_024,
};

/**
 * What the host cache added to llama-server's peak RSS at its cap, over none, by cap in MiB: the larger of the two
 * windows measured (12,288 and 32,768; the cap is the cache's own count, not the process's growth).
 */
export const MEASURED_HOST_CACHE_BYTES: Readonly<Record<number, number>> = {
  0: 0,
  1_024: 3_210_000_000,
};

const hostCacheBytes = (tier: HardwareTier) => MEASURED_HOST_CACHE_BYTES[HOST_PROMPT_CACHE_MIB[tier]] ?? 0;

/** The memory each tier starts at (TIER_RULES); High's floor is its own rule. */
const TIER_FLOOR_GIB: Readonly<Record<HardwareTier, number>> = {
  minimum: TIER_RULES.minMemoryGiB,
  recommended: TIER_RULES.recommendedMemoryGiB,
  high: TIER_RULES.highMemoryGiB,
};

/**
 * What a tier's resident local models (the sidecar and the embedder) may hold together: the same share of the tier's
 * memory floor as spike 08 gave the Recommended tier's, RECOMMENDED_SHARE_SIDECAR_BYTES beside the embedder (6.29 of
 * 16 GiB measured). A window never takes more of a Mac's memory than that.
 */
export function localModelBudgetBytes(tier: HardwareTier): number {
  const recommended = RECOMMENDED_SHARE_SIDECAR_BYTES + MEASURED_EMBEDDER_BYTES;
  return (recommended * TIER_FLOOR_GIB[tier]) / TIER_RULES.recommendedMemoryGiB;
}

const TIER_ORDER: readonly HardwareTier[] = ['minimum', 'recommended', 'high'];
const runsOn = (model: Omit<LocalRuntimeModel, 'contextWindow'>, tier: HardwareTier) => {
  const at = TIER_ORDER.indexOf(tier);
  return at >= TIER_ORDER.indexOf(model.minTier) && at <= TIER_ORDER.indexOf(model.maxTier ?? 'high');
};

/**
 * The largest window measured for the tier's model whose peak, beside the embedder, fits the tier's budget; a tier
 * whose model fits none, or has none measured, gets SMALLEST_LOCAL_WINDOW.
 */
export function contextWindowFor(tier: HardwareTier): number {
  const model = LLAMA_CPP_MODELS.find((m) => runsOn(m, tier));
  const peaks = Object.entries((model && MEASURED_PEAK_BYTES[model.id]) ?? {});
  // AGT1: the host prompt cache counts too.
  const budget = localModelBudgetBytes(tier) - hostCacheBytes(tier);
  const fits = peaks
    .filter(([, peak]) => peak + MEASURED_EMBEDDER_BYTES <= budget)
    .map(([window]) => Number(window));
  return Math.max(SMALLEST_LOCAL_WINDOW, ...fits);
}

/** The runtime as a tier runs it: every model with that tier's window (the sidecar's --ctx-size). */
export function llamaCppRuntimeSpec(tier: HardwareTier): LocalRuntimeSpec {
  const contextWindow = contextWindowFor(tier);
  return {
    name: LLAMA_CPP_RUNTIME_NAME,
    runtimeComponentId: 'local-llm-runtime',
    runtimeBuilds: LLAMA_CPP_BUILDS,
    // llama-server serves one model per process, so the first installed model a tier allows is the one loaded:
    // biggest first.
    models: LLAMA_CPP_MODELS.map((model) => ({
      ...model,
      contextWindow,
      hostCacheMiB: HOST_PROMPT_CACHE_MIB[tier],
    })),
  };
}

/**
 * What a GPU with memory of its own keeps beside the sidecar: the embedder (its measured peak) and 2 GiB for
 * whisper's model, ONNX Runtime's sessions and the desktop.
 */
export const VRAM_RESERVE_BYTES = MEASURED_EMBEDDER_BYTES + 2 * 1024 ** 3;

/** At most this many slots: each is a request answered at once (the agent, shot descriptions, search). */
export const MAX_LOCAL_SLOTS = 4;

export interface LlamaSlots {
  /** `--parallel`. */
  readonly parallel: number;
  /** `--ctx-size`: the window times the slots (an explicit `--parallel` splits the cache per slot). */
  readonly ctxSize: number;
  /** Every layer on the GPU (`--n-gpu-layers 99`); false: llama.cpp's `--fit` places them in the memory there is. */
  readonly allLayers: boolean;
}

/** The model's measured footprint: what it holds at no window, and what each token of window adds (q8_0). */
function footprint(
  model: LocalRuntimeModel,
): { readonly base: number; readonly perToken: number } | undefined {
  const peaks = Object.entries(MEASURED_PEAK_BYTES[model.id] ?? {})
    .map(([window, peak]) => [Number(window), peak] as const)
    .sort(([a], [b]) => a - b);
  const [first, last] = [peaks[0], peaks[peaks.length - 1]];
  if (!first || !last || last[0] === first[0]) return undefined;
  const perToken = (last[1] - first[1]) / (last[0] - first[0]);
  return { base: first[1] - perToken * first[0], perToken };
}

/**
 * Slots and context for a GPU with `vramBytes` free (LNX1, Linux NVIDIA): after VRAM_RESERVE_BYTES, the model's
 * footprint at its window, then as many more windows as fit, up to MAX_LOCAL_SLOTS. Unified memory (no VRAM figure)
 * keeps one slot at the tier's window (spike 08); a GPU too small for one window leaves the layers to `--fit`.
 */
export function vramSlots(model: LocalRuntimeModel, vramBytes: number | undefined): LlamaSlots {
  const one = { parallel: 1, ctxSize: model.contextWindow, allLayers: true };
  const measured = footprint(model);
  if (vramBytes === undefined || !measured) return one;
  const budget = vramBytes - VRAM_RESERVE_BYTES - measured.base;
  const perSlot = measured.perToken * model.contextWindow;
  if (budget < perSlot) return { ...one, allLayers: false };
  const parallel = Math.min(MAX_LOCAL_SLOTS, Math.floor(budget / perSlot));
  return { parallel, ctxSize: model.contextWindow * parallel, allLayers: true };
}
