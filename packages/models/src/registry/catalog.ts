// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Taalcut's model registry: facts pi-ai's catalogue doesn't have. Models
 * served outside pi-ai (the embedded local runtime, on-device ONNX,
 * ElevenLabs, and a user's own Ollama under Advanced), the
 * hardware tier a local model needs, and retirement dates for the deprecation
 * watcher (PRD 8.4). Chat, image and classifier models that pi-ai serves take
 * their prices and capabilities from pi-ai at run time; they appear here only
 * when there is something to add.
 */
import { CHATGPT_IMAGE_PROVIDER } from '@taalcut/core';
import type { ComputeBackend } from '../hardware/compute';
import type { HardwareTier } from '../hardware/types';
import { LLAMA_CPP_MODELS, LLAMA_CPP_RUNTIME_NAME } from '../local-runtime/llama-cpp-spec';
import { MLX_MODELS, MLX_RUNTIME_NAME } from '../local-runtime/mlx-spec';
import { LOCAL_RUNTIME_PROVIDER } from '../local-runtime/types';
import { choiceKey, type ModelChoice, type ModelKind } from '../modules';
import { replacementFor, SUPERSEDED_ON } from './current-models';

export interface CatalogEntry {
  readonly provider: string;
  readonly model: string;
  readonly kind: ModelKind;
  /**
   * Who serves it: pi-ai (built-in providers); the embedded local runtime the
   * app downloads and runs (D16); a server the user runs themselves, offered
   * only under Advanced and never in a built-in profile; or Taalcut directly.
   */
  readonly servedBy: 'pi-ai' | 'embedded-runtime' | 'own-server' | 'taalcut';
  /** Runs on this machine; nothing leaves the device. */
  readonly local: boolean;
  /** Smallest hardware tier that runs it at a usable speed. */
  readonly minTier?: HardwareTier;
  /** Last day the provider serves it (ISO date). From this day on it is retired. */
  readonly retiresOn?: string;
  readonly replacement?: Pick<ModelChoice, 'provider' | 'model'>;
  /** i18n key for a note shown next to the model, e.g. lower quality for small local models. */
  readonly noteKey?: string;
  /**
   * Local models: the backends its runtime can use, accelerated first (ADR
   * 0002). The machine's backends pick one; 'cpu' alone means CPU-only. An
   * empty list means no model inference at all (a file library).
   */
  readonly compute?: readonly ComputeBackend[];
  /** Chosen by a provisional spike result, e.g. 'P1-J8': may change when its open items close. */
  readonly provisional?: string;
  /** Product name for the model picker, shown as is. Entries pi-ai lists take pi-ai's name. */
  readonly name?: string;
  /** Product name of the local runtime that runs it, for Settings → About, e.g. 'ONNX Runtime'. */
  readonly runtime?: string;
}

const LOWER_QUALITY = 'models.note.local_lower_quality';
/** Ollama: Metal on Apple Silicon; CUDA, ROCm or Vulkan elsewhere; CPU only when none is there. */
const OLLAMA: readonly ComputeBackend[] = ['metal', 'cuda', 'rocm', 'vulkan', 'cpu'];
/**
 * ONNX Runtime execution providers: Core ML (Neural Engine, then GPU), DirectML, CUDA, WebGPU (Metal or Vulkan
 * through Dawn: onnxruntime-node's darwin and linux-x64 builds list it), then the CPU EP.
 */
const ONNX_RUNTIME: readonly ComputeBackend[] = ['ane', 'coreml', 'directml', 'cuda', 'webgpu', 'cpu'];

const entry = (e: CatalogEntry): CatalogEntry => e;

/** Bring your own Ollama (Advanced only): known tags, so the picker can show tier and compute. */
const ownOllama = (model: string, minTier?: HardwareTier): CatalogEntry => ({
  provider: 'ollama',
  model,
  name: model,
  runtime: 'Ollama',
  kind: 'chat',
  servedBy: 'own-server',
  local: true,
  compute: OLLAMA,
  ...(minTier ? { minTier } : {}),
  noteKey: LOWER_QUALITY,
});

export const MODEL_CATALOG: readonly CatalogEntry[] = [
  // MLX1: Qwen3.5 9B on Taalcut's MLX server, on Apple silicon Macs of the High tier (local-runtime/mlx-spec.ts).
  // Lower quality than the cloud's models too; elsewhere, or below High, the resolver skips it for the 4B.
  ...MLX_MODELS.map((m) =>
    entry({
      provider: LOCAL_RUNTIME_PROVIDER,
      model: m.id,
      ...(m.name ? { name: m.name } : {}),
      runtime: MLX_RUNTIME_NAME,
      kind: 'chat',
      servedBy: 'embedded-runtime',
      local: true,
      compute: m.compute,
      minTier: m.minTier,
      noteKey: LOWER_QUALITY,
      provisional: 'MLX1',
    }),
  ),
  // Local chat and vision models in the embedded runtime (PRD 8.2, D16), labelled lower quality.
  // Spike 08 (provisional): llama.cpp's llama-server serving Qwen3.5 4B for text and frames.
  ...LLAMA_CPP_MODELS.map((m) =>
    entry({
      provider: LOCAL_RUNTIME_PROVIDER,
      model: m.id,
      ...(m.name ? { name: m.name } : {}),
      runtime: LLAMA_CPP_RUNTIME_NAME,
      kind: 'chat',
      servedBy: 'embedded-runtime',
      local: true,
      compute: m.compute,
      ...(m.minTier !== 'minimum' ? { minTier: m.minTier } : {}),
      noteKey: LOWER_QUALITY,
      provisional: 'P1-J8',
    }),
  ),
  // Advanced → your own server. Ollama performs badly for Taalcut's use (D16) and is never a default.
  ownOllama('qwen3.5:4b', 'recommended'),
  ownOllama('qwen3:1.7b'),
  ownOllama('qwen3:0.6b'),
  ownOllama('qwen3-vl:4b', 'recommended'),
  ownOllama('qwen3-vl:2b'),
  // The router's decision model, pinned (P3-B11). Served over Taalcut's own fetch (classify/system-one.ts):
  // pi-ai's catalogue has only the jev-latest alias.
  entry({
    provider: 'typesafe',
    model: 'jev-1.13.0',
    name: 'Jev 1.13.0',
    kind: 'classifier',
    servedBy: 'taalcut',
    local: false,
  }),
  // Router without a network: Taalcut's rules plus the local model (PRD 8.2).
  // Keyword and pattern rules, no model: CPU-only by nature, so it sits last in every chain.
  entry({
    provider: 'taalcut',
    model: 'rules-router',
    name: 'Taalcut rules',
    kind: 'classifier',
    servedBy: 'taalcut',
    local: true,
    compute: ['cpu'],
  }),
  // Embeddings: EmbeddingGemma 2 on-device is the only embedding model in v1 (decided 2026-10-12).
  entry({
    provider: 'onnx',
    model: 'embeddinggemma-2',
    name: 'EmbeddingGemma 2',
    runtime: 'ONNX Runtime',
    kind: 'embedding',
    servedBy: 'taalcut',
    local: true,
    compute: ONNX_RUNTIME,
  }),
  // Speech to text.
  entry({
    provider: 'elevenlabs',
    model: 'scribe_v2',
    name: 'ElevenLabs Scribe v2',
    kind: 'speech-to-text',
    servedBy: 'taalcut',
    local: false,
  }),
  entry({
    provider: 'sherpa-onnx',
    model: 'parakeet-tdt-0.6b-v3',
    name: 'Parakeet TDT 0.6B v3',
    runtime: 'sherpa-onnx',
    kind: 'speech-to-text',
    servedBy: 'taalcut',
    local: true,
    // sherpa-onnx providers: Core ML, CUDA, DirectML, CPU.
    compute: ['coreml', 'cuda', 'directml', 'cpu'],
  }),
  entry({
    provider: 'whisper-cpp',
    model: 'large-v3-turbo',
    name: 'Whisper large-v3 turbo',
    runtime: 'whisper.cpp',
    kind: 'speech-to-text',
    servedBy: 'taalcut',
    local: true,
    minTier: 'recommended',
    compute: ['metal', 'cuda', 'vulkan', 'cpu'],
  }),
  // Voice and music.
  entry({
    provider: 'elevenlabs',
    model: 'eleven_v4',
    name: 'ElevenLabs v4',
    kind: 'text-to-speech',
    servedBy: 'taalcut',
    local: false,
  }),
  entry({
    provider: 'elevenlabs',
    model: 'eleven_v4_turbo',
    name: 'ElevenLabs v4 Turbo',
    kind: 'text-to-speech',
    servedBy: 'taalcut',
    local: false,
  }),
  entry({
    provider: 'resemble',
    model: 'chatterbox-multilingual',
    name: 'Chatterbox Multilingual 0.5B',
    runtime: 'ONNX Runtime',
    kind: 'text-to-speech',
    servedBy: 'taalcut',
    local: true,
    minTier: 'recommended',
    compute: ONNX_RUNTIME,
    noteKey: LOWER_QUALITY,
  }),
  entry({
    provider: 'resemble',
    model: 'chatterbox-turbo',
    name: 'Chatterbox Turbo 350M',
    runtime: 'ONNX Runtime',
    kind: 'text-to-speech',
    servedBy: 'taalcut',
    local: true,
    compute: ONNX_RUNTIME,
    noteKey: LOWER_QUALITY,
  }),
  // Codex Images is a dedicated subscription endpoint, outside pi-ai's image implementations.
  entry({
    provider: CHATGPT_IMAGE_PROVIDER,
    model: 'gpt-image-2',
    name: 'ChatGPT Images',
    kind: 'image',
    servedBy: 'taalcut',
    local: false,
  }),
  // Bring your own ComfyUI (Advanced only): local image generation on the user's server.
  entry({
    provider: 'comfyui',
    model: 'comfyui/flux-1-schnell',
    name: 'Flux.1 Schnell (ComfyUI)',
    runtime: 'ComfyUI',
    kind: 'image',
    servedBy: 'own-server',
    local: true,
    minTier: 'recommended',
    compute: OLLAMA,
    noteKey: LOWER_QUALITY,
  }),
  entry({
    provider: 'comfyui',
    model: 'comfyui/sdxl-turbo',
    name: 'SDXL Turbo (ComfyUI)',
    runtime: 'ComfyUI',
    kind: 'image',
    servedBy: 'own-server',
    local: true,
    compute: OLLAMA,
    noteKey: LOWER_QUALITY,
  }),
  entry({
    provider: 'comfyui',
    model: 'comfyui/z-image-turbo',
    name: 'Z-Image Turbo (ComfyUI)',
    runtime: 'ComfyUI',
    kind: 'image',
    servedBy: 'own-server',
    local: true,
    compute: OLLAMA,
    noteKey: LOWER_QUALITY,
  }),
  entry({
    provider: 'elevenlabs',
    model: 'music_v2_5',
    name: 'ElevenLabs Music v2.5',
    kind: 'music',
    servedBy: 'taalcut',
    local: false,
  }),
  entry({
    provider: 'taalcut',
    model: 'royalty-free-library',
    name: 'Taalcut royalty-free library',
    kind: 'music',
    servedBy: 'taalcut',
    local: true,
    compute: [],
  }),
  // Retirements (PRD 8.4; research image-generation.md, 2026-10-14). The images routes never send these.
  ...(
    [
      ['openai/gpt-image-1', '2026-10-23', 'openai/gpt-image-2.5-flare'],
      ['openai/gpt-image-1.5', '2026-12-01', 'openai/gpt-image-2.5-flare'],
      ['openai/gpt-image-1-mini', '2026-12-01', 'openai/gpt-image-2.5-flare'],
      ['openai/chatgpt-image-latest', '2026-12-01', 'openai/gpt-image-2.5-flare'],
      ['google/gemini-2.5-flash-image', '2026-10-02', 'google/gemini-nano-banana-2.1'],
    ] as const
  ).map(([model, retiresOn, replacement]) =>
    entry({
      provider: 'openrouter',
      model,
      kind: 'image',
      servedBy: 'pi-ai',
      local: false,
      retiresOn,
      replacement: { provider: 'openrouter', model: replacement },
    }),
  ),
  // Google shut down Imagen 4 on 2026-08-17.
  entry({
    provider: 'google',
    model: 'imagen-4',
    name: 'Imagen 4',
    kind: 'image',
    servedBy: 'taalcut',
    local: false,
    retiresOn: '2026-08-17',
    replacement: { provider: 'openrouter', model: 'google/gemini-nano-banana-2.1' },
  }),
];

export interface Catalog {
  find(choice: Pick<ModelChoice, 'provider' | 'model'>): CatalogEntry | undefined;
  entries(): readonly CatalogEntry[];
}

export function createCatalog(entries: readonly CatalogEntry[] = MODEL_CATALOG): Catalog {
  const byKey = new Map(entries.map((e) => [choiceKey(e), e]));
  return {
    find: (choice) => byKey.get(choiceKey(choice)) ?? superseded(choice),
    entries: () => entries,
  };
}

/**
 * An older generation of a provider Taalcut keeps a current list for (registry/current-models.ts): retired on
 * SUPERSEDED_ON in favour of its role's current model, so the resolver, the picker and the deprecation watcher
 * treat it as they treat any retired model.
 */
function superseded(choice: Pick<ModelChoice, 'provider' | 'model'>): CatalogEntry | undefined {
  const replacement = replacementFor(choice);
  if (!replacement) return undefined;
  return {
    provider: choice.provider,
    model: choice.model,
    kind: 'chat',
    servedBy: 'pi-ai',
    local: false,
    retiresOn: SUPERSEDED_ON,
    replacement,
  };
}

/** Whole days from `today` to `isoDate` (negative once past). Both 'YYYY-MM-DD'. */
export function daysUntil(today: string, isoDate: string): number {
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function isRetired(entry: CatalogEntry | undefined, today: string): boolean {
  return entry?.retiresOn !== undefined && today >= entry.retiresOn;
}
