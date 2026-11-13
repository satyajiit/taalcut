// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- fake backend data (product names, ids, people's requests), never UI copy */

/**
 * Fixture data for the fake backend: @taalcut/models' four built-in profiles
 * (registry/builtin-profiles.ts) and the catalogue facts the Settings screen
 * shows (local, minimum tier, retirement dates). The renderer can't import
 * @taalcut/models, so this restates them; the real backend sends the real ones.
 * Local chat and vision run in Taalcut's bundled runtime (provider
 * 'on-device', @taalcut/models' LOCAL_RUNTIME_PROVIDER): llama.cpp b11571 on
 * Metal serving Qwen3.5 4B for text and frames alike from the Recommended
 * tier up (spike 08), and Qwen3.5 0.8B, text only, on the Minimum tier (J8b).
 * Thinking is off for both. Not Ollama, per the "nothing to install" rule.
 */
import type { ModelModuleId, ReasoningLevel, HardwareTier, ModelChoice } from '@taalcut/core';

const m = (provider: string, model: string, reasoning?: ReasoningLevel): ModelChoice =>
  reasoning ? { provider, model, reasoning } : { provider, model };

export const BUILTIN_PROFILE_IDS = ['fast-cheap', 'balanced', 'best-quality', 'local-only'] as const;
export type FakeProfileId = (typeof BUILTIN_PROFILE_IDS)[number];

type Chains = Record<ModelModuleId, ModelChoice[]>;

/** @taalcut/models' LOCAL_RUNTIME_PROVIDER: Taalcut's bundled runtime. */
export const ON_DEVICE = 'on-device';

const local = {
  // One model for text and frames, thinking off (spike 08: thinking tokens would eat the 8,192-token context).
  agent: m(ON_DEVICE, 'qwen3.5-4b', 'off'),
  vision: m(ON_DEVICE, 'qwen3.5-4b', 'off'),
  // What an 8 GB Mac can hold (J8b): text only, so it never stands in for vision.
  agentSmall: m(ON_DEVICE, 'qwen3.5-0.8b', 'off'),
  router: m('taalcut', 'rules-router'),
  embeddings: m('onnx', 'embeddinggemma-2'),
  parakeet: m('sherpa-onnx', 'parakeet-tdt-0.6b-v3'),
  whisper: m('whisper-cpp', 'large-v3-turbo'),
  music: m('taalcut', 'royalty-free-library'),
};
const cloud = {
  clefFlash: m('cloudflare-workers-ai', '@cf/cloudflare/clef-flash'),
  clef: m('cloudflare-workers-ai', '@cf/cloudflare/clef'),
  jev: m('typesafe', 'jev-latest'),
  scribe: m('elevenlabs', 'scribe_v2'),
  voice: m('elevenlabs', 'eleven_v4'),
  voiceTurbo: m('elevenlabs', 'eleven_v4_turbo'),
  music: m('elevenlabs', 'music_v2_5'),
  flare: m('openrouter', 'openai/gpt-image-2.5-flare'),
  sunburst: m('openrouter', 'openai/gpt-image-2.5-sunburst'),
  grok: m('openrouter', 'x-ai/grok-imagine-image-2.0'),
  banana: m('openrouter', 'google/gemini-nano-banana-2.1'),
  geminiPro: m('openrouter', 'google/gemini-3-pro-image'),
};

export const PROFILE_CHAINS: Record<FakeProfileId, Chains> = {
  'fast-cheap': {
    agent: [
      m('anthropic', 'claude-haiku-5-5', 'low'),
      m('openai', 'gpt-6-luna', 'low'),
      m('google', 'gemini-3.5-flash-lite', 'low'),
    ],
    router: [cloud.jev, cloud.clefFlash, local.router],
    vision: [local.vision, m('google', 'gemini-3.5-flash-lite', 'low'), m('openai', 'gpt-6-luna', 'low')],
    embeddings: [local.embeddings],
    speech: [local.parakeet, cloud.scribe],
    voice: [cloud.voiceTurbo],
    music: [local.music, cloud.music],
    images: [cloud.grok, cloud.banana],
  },
  balanced: {
    agent: [
      m('openai', 'gpt-6.1-sol', 'medium'),
      m('anthropic', 'claude-sonnet-5-5', 'medium'),
      m('google', 'gemini-3.8-flash', 'medium'),
    ],
    router: [cloud.jev, cloud.clefFlash, local.router],
    vision: [local.vision, m('google', 'gemini-3.8-flash', 'low'), m('openai', 'gpt-6-luna', 'low')],
    embeddings: [local.embeddings],
    speech: [cloud.scribe, local.parakeet],
    voice: [cloud.voice, cloud.voiceTurbo],
    music: [cloud.music, local.music],
    images: [cloud.flare, cloud.banana, cloud.grok],
  },
  'best-quality': {
    agent: [
      m('openai', 'gpt-6-astra', 'high'),
      m('anthropic', 'claude-opus-5-5', 'high'),
      m('google', 'gemini-4-argon', 'high'),
    ],
    router: [cloud.jev, cloud.clef, local.router],
    vision: [m('google', 'gemini-4-argon', 'low'), m('anthropic', 'claude-sonnet-5-5', 'low'), local.vision],
    embeddings: [local.embeddings],
    speech: [cloud.scribe, local.whisper, local.parakeet],
    voice: [cloud.voice],
    music: [cloud.music],
    images: [cloud.sunburst, cloud.geminiPro, cloud.flare],
  },
  'local-only': {
    // On the Minimum tier the 4B is skipped: the agent runs on the 0.8B, and vision has nothing.
    agent: [local.agent, local.agentSmall],
    router: [local.router],
    vision: [local.vision],
    embeddings: [local.embeddings],
    speech: [local.parakeet, local.whisper],
    voice: [],
    music: [local.music],
    images: [],
  },
};

export interface FakeCatalogEntry {
  readonly provider: string;
  readonly model: string;
  readonly name: string;
  readonly modules: readonly ModelModuleId[];
  readonly local: boolean;
  readonly reasoning: boolean;
  /** Chat models: the reasoning levels pi-ai 1.4.0 gives it (on-device: off only). */
  readonly thinking?: readonly ReasoningLevel[];
  /** Weights a bigger tier doesn't download (the 0.8B stops at Minimum): 'not-installed' above it. */
  readonly maxTier?: HardwareTier;
  readonly minTier?: HardwareTier;
  readonly retiresOn?: string;
  readonly replacement?: ModelChoice;
  readonly noteKey?: string;
  /** Rough list prices per million tokens, for the fake cloud-call log. */
  readonly usdPerMTokIn?: number;
  readonly usdPerMTokOut?: number;
}

const LOWER = 'models.note.local_lower_quality';
const chat = ['agent', 'vision'] as const;
type Extra = Partial<
  Pick<FakeCatalogEntry, 'minTier' | 'maxTier' | 'retiresOn' | 'replacement' | 'noteKey' | 'thinking'>
>;

/**
 * pi-ai 1.4.0's levels for these models on an API key (the models package tests the real ones): OpenAI's
 * reasoning efforts (GPT-6 Luna from none, Sol and Astra from low, both to max), Anthropic's effort, Google's
 * thinking level. The superseded models keep theirs until Settings moves them on (UX3-AGT).
 */
const FULL: Extra = { thinking: ['off', 'low', 'medium', 'high', 'xhigh', 'max'] };
const LOW_TO_MAX: Extra = { thinking: ['low', 'medium', 'high', 'xhigh', 'max'] };
const FLASH_LITE: Extra = { thinking: ['minimal', 'low', 'medium', 'high'] };
const LOW_TO_HIGH: Extra = { thinking: ['low', 'medium', 'high'] };
const ON_DEVICE_THINKING: Extra = { thinking: ['off'] };
/** pi-ai 1.4.0's release: the day it stopped listing the models before its latest generation. */
const SUPERSEDED_ON = '2026-10-21';
const superseded = (provider: string, model: string): Extra => ({
  retiresOn: SUPERSEDED_ON,
  replacement: m(provider, model),
});

/** A cloud model. `price` is [in, out] US$ per million tokens, for the fake cloud-call log. */
const cloudModel = (
  id: string,
  name: string,
  modules: readonly ModelModuleId[],
  price?: [number, number],
  extra: Extra = {},
): FakeCatalogEntry => {
  const [provider = '', model = ''] = id.split(/\/(.*)/s);
  const reasoning = modules.includes('agent') || modules.includes('vision');
  return { provider, model, name, modules, local: false, reasoning, ...extra, ...priced(price) };
};
const priced = (price?: [number, number]) =>
  price ? { usdPerMTokIn: price[0], usdPerMTokOut: price[1] } : {};
const localModel = (
  id: string,
  name: string,
  modules: readonly ModelModuleId[],
  extra: Extra = {},
): FakeCatalogEntry => ({ ...cloudModel(id, name, modules, undefined, extra), local: true });

export const FAKE_CATALOG: readonly FakeCatalogEntry[] = [
  cloudModel('openai/gpt-6-astra', 'GPT-6 Astra', chat, [10, 50], LOW_TO_MAX),
  cloudModel('openai/gpt-6.1-sol', 'GPT-6.1 Sol', chat, [2, 10], LOW_TO_MAX),
  cloudModel('openai/gpt-6-luna', 'GPT-6 Luna', chat, [0.1, 0.5], FULL),
  cloudModel('anthropic/claude-opus-5-5', 'Claude Opus 5.5', chat, [4, 20], LOW_TO_MAX),
  cloudModel('anthropic/claude-sonnet-5-5', 'Claude Sonnet 5.5', chat, [2, 10], LOW_TO_MAX),
  cloudModel('anthropic/claude-haiku-5-5', 'Claude Haiku 5.5', chat, [0.1, 0.5], FULL),
  cloudModel('google/gemini-4-argon', 'Gemini 4 Argon', chat, [2, 10], LOW_TO_HIGH),
  cloudModel('google/gemini-3.8-flash', 'Gemini 3.8 Flash', chat, [0.75, 3.75], LOW_TO_HIGH),
  cloudModel('google/gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', chat, [0.3, 2.5], FLASH_LITE),
  // A saved choice from before pi-ai 1.4.0: offered no more, it runs as its role's current model (UX3-AGT).
  cloudModel('openai/gpt-5.4', 'GPT-5.4', chat, [1.25, 10], {
    thinking: ['off', 'low', 'medium', 'high', 'xhigh'],
    ...superseded('openai', 'gpt-6.1-sol'),
  }),
  localModel(`${ON_DEVICE}/qwen3.5-4b`, 'Qwen3.5 4B', chat, {
    minTier: 'recommended',
    noteKey: LOWER,
    ...ON_DEVICE_THINKING,
  }),
  localModel(`${ON_DEVICE}/qwen3.5-0.8b`, 'Qwen3.5 0.8B', ['agent'], {
    maxTier: 'minimum',
    noteKey: LOWER,
    ...ON_DEVICE_THINKING,
  }),
  cloudModel('cloudflare-workers-ai/@cf/cloudflare/clef-flash', 'Clef Flash', ['router'], [0.038, 0.038]),
  cloudModel('cloudflare-workers-ai/@cf/cloudflare/clef', 'Clef', ['router'], [0.2, 0.2]),
  cloudModel('typesafe/jev-latest', 'Jev', ['router'], [0.1, 0.1]),
  localModel('taalcut/rules-router', 'Taalcut rules', ['router']),
  localModel('onnx/embeddinggemma-2', 'EmbeddingGemma 2', ['embeddings']),
  cloudModel('elevenlabs/scribe_v2', 'Scribe v2', ['speech']),
  localModel('sherpa-onnx/parakeet-tdt-0.6b-v3', 'Parakeet TDT 0.6B v3', ['speech']),
  localModel('whisper-cpp/large-v3-turbo', 'Whisper large-v3 turbo', ['speech'], { minTier: 'recommended' }),
  cloudModel('elevenlabs/eleven_v4', 'Eleven v4', ['voice']),
  cloudModel('elevenlabs/eleven_v4_turbo', 'Eleven v4 Turbo', ['voice']),
  cloudModel('elevenlabs/music_v2_5', 'Eleven Music v2.5', ['music']),
  localModel('taalcut/royalty-free-library', 'Royalty-free library', ['music']),
  cloudModel('openrouter/openai/gpt-image-2.5-flare', 'GPT Image 2.5 Flare', ['images']),
  cloudModel('openrouter/openai/gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst', ['images']),
  cloudModel('openrouter/openai/gpt-image-2', 'GPT Image 2', ['images']),
  // PRD 8.4: gpt-image-1 shuts down on 2026-10-23.
  cloudModel('openrouter/openai/gpt-image-1', 'GPT Image 1', ['images'], undefined, {
    retiresOn: '2026-10-23',
    replacement: m('openrouter', 'openai/gpt-image-2'),
  }),
  cloudModel('openrouter/x-ai/grok-imagine-image-2.0', 'Grok Imagine Image 2.0', ['images']),
  cloudModel('openrouter/google/gemini-nano-banana-2.1', 'Gemini Nano Banana 2.1', ['images']),
  cloudModel('openrouter/google/gemini-3-pro-image', 'Gemini 3 Pro Image', ['images']),
];

export const findEntry = (choice: Pick<ModelChoice, 'provider' | 'model'>) =>
  FAKE_CATALOG.find((e) => e.provider === choice.provider && e.model === choice.model);
