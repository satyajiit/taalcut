// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The four built-in profiles (PRD 8.4). Each sets every module at once. Local
 * models carry a hardware tier in the catalogue; on a smaller Mac the resolver
 * skips them, which is how an 8 GB machine ends up with cloud vision (PRD 11).
 * Model ids must exist in pi-ai 1.4.0's catalogue or in MODEL_CATALOG, and a
 * cloud pick is its provider's current model for the role
 * (registry/current-models.ts, UX3-AGT); tests check all three, and that each
 * thinking level is one the model takes. Local chat and vision run in the
 * embedded runtime the app downloads (D16: llama-server, spike 08), never in
 * a server the user has to install; Ollama and LM Studio are only custom
 * servers under Advanced.
 */
import { CHATGPT_IMAGE_PROVIDER } from '@taalcut/core';
import { LOCAL_RUNTIME_PROVIDER } from '../local-runtime/types';
import type { ModelChoice, ReasoningLevel } from '../modules';
import type { BuiltinProfileId, ModelProfile } from './profile-schema';

const m = (provider: string, model: string, reasoning?: ReasoningLevel): ModelChoice =>
  reasoning ? { provider, model, reasoning } : { provider, model };

const local = {
  // MLX1: Qwen3.5 9B on MLX, text and frames in one process, on Apple silicon Macs of the High tier; the resolver
  // skips it below High, and where it isn't served (another platform, not downloaded yet) the call moves on to the
  // 4B at once.
  agentLarge: m(LOCAL_RUNTIME_PROVIDER, 'qwen3.5-9b', 'off'),
  visionLarge: m(LOCAL_RUNTIME_PROVIDER, 'qwen3.5-9b', 'off'),
  // Qwen3.5 4B does text and frames in one process. Thinking stays off (enable_thinking: false):
  // spike 08 timed it that way, and thinking tokens would eat the 8,192-token context.
  agent: m(LOCAL_RUNTIME_PROVIDER, 'qwen3.5-4b', 'off'),
  vision: m(LOCAL_RUNTIME_PROVIDER, 'qwen3.5-4b', 'off'),
  // What an 8 GB Mac can hold (spike 08, J8b): text only, so it never stands in for vision.
  agentSmall: m(LOCAL_RUNTIME_PROVIDER, 'qwen3.5-0.8b', 'off'),
  router: m('taalcut', 'rules-router'),
  embeddings: m('onnx', 'embeddinggemma-2'),
  parakeet: m('sherpa-onnx', 'parakeet-tdt-0.6b-v3'),
  whisper: m('whisper-cpp', 'large-v3-turbo'),
  music: m('taalcut', 'royalty-free-library'),
};

const cloud = {
  clefFlash: m('cloudflare-workers-ai', '@cf/cloudflare/clef-flash'),
  clef: m('cloudflare-workers-ai', '@cf/cloudflare/clef'),
  // Pinned (P3-B11): an alias move can't change a shadow comparison mid-run.
  jev: m('typesafe', 'jev-1.13.0'),
  scribe: m('elevenlabs', 'scribe_v2'),
  voice: m('elevenlabs', 'eleven_v4'),
  voiceTurbo: m('elevenlabs', 'eleven_v4_turbo'),
  music: m('elevenlabs', 'music_v2_5'),
  imageFlare: m('openrouter', 'openai/gpt-image-2.5-flare'),
  imageSunburst: m('openrouter', 'openai/gpt-image-2.5-sunburst'),
  imageGrok: m('openrouter', 'x-ai/grok-imagine-image-2.0'),
  imageNanoBanana: m('openrouter', 'google/gemini-nano-banana-2.1'),
  imageGeminiPro: m('openrouter', 'google/gemini-3-pro-image'),
  imageChatGPT: m(CHATGPT_IMAGE_PROVIDER, 'gpt-image-2'),
};

const profile = (id: BuiltinProfileId, modules: ModelProfile['modules']): ModelProfile => ({
  id,
  labelKey: `models.profile.${id}.label`,
  descriptionKey: `models.profile.${id}.description`,
  modules,
});

export const BUILTIN_PROFILES: readonly ModelProfile[] = [
  profile('fast-cheap', {
    agent: {
      chain: [
        m('anthropic', 'claude-haiku-5-5', 'low'),
        m('openai', 'gpt-6-luna', 'low'),
        m('google', 'gemini-3.5-flash-lite', 'low'),
      ],
    },
    // Spike 04: Jev first, Clef-flash as the runner-up on the same question shape.
    router: { chain: [cloud.jev, cloud.clefFlash, local.router] },
    vision: {
      chain: [
        local.visionLarge,
        local.vision,
        m('google', 'gemini-3.5-flash-lite', 'low'),
        m('openai', 'gpt-6-luna', 'low'),
      ],
    },
    embeddings: { chain: [local.embeddings] },
    speech: { chain: [local.parakeet, cloud.scribe] },
    voice: { chain: [cloud.voiceTurbo] },
    music: { chain: [local.music, cloud.music] },
    images: { chain: [cloud.imageGrok, cloud.imageNanoBanana, cloud.imageChatGPT] },
  }),
  profile('balanced', {
    agent: {
      chain: [
        m('openai', 'gpt-6.1-sol', 'medium'),
        m('anthropic', 'claude-sonnet-5-5', 'medium'),
        m('google', 'gemini-3.8-flash', 'medium'),
      ],
    },
    router: { chain: [cloud.jev, cloud.clefFlash, local.router] },
    vision: {
      chain: [
        local.visionLarge,
        local.vision,
        m('google', 'gemini-3.8-flash', 'low'),
        m('openai', 'gpt-6-luna', 'low'),
      ],
    },
    embeddings: { chain: [local.embeddings] },
    speech: { chain: [cloud.scribe, local.parakeet] },
    voice: { chain: [cloud.voice, cloud.voiceTurbo] },
    music: { chain: [cloud.music, local.music] },
    images: { chain: [cloud.imageFlare, cloud.imageNanoBanana, cloud.imageGrok, cloud.imageChatGPT] },
  }),
  profile('best-quality', {
    agent: {
      chain: [
        m('openai', 'gpt-6-astra', 'high'),
        m('anthropic', 'claude-opus-5-5', 'high'),
        m('google', 'gemini-4-argon', 'high'),
      ],
    },
    // Full Clef is slower and pricier than Jev and still behind it on When2Call (spike 04).
    router: { chain: [cloud.jev, cloud.clef, local.router] },
    vision: {
      chain: [
        m('google', 'gemini-4-argon', 'low'),
        m('anthropic', 'claude-sonnet-5-5', 'low'),
        local.visionLarge,
        local.vision,
      ],
    },
    embeddings: { chain: [local.embeddings] },
    speech: { chain: [cloud.scribe, local.whisper, local.parakeet] },
    voice: { chain: [cloud.voice] },
    music: { chain: [cloud.music] },
    images: {
      chain: [
        cloud.imageSunburst,
        cloud.imageGeminiPro,
        cloud.imageFlare,
        cloud.imageChatGPT,
        cloud.imageGrok,
      ],
    },
  }),
  profile('local-only', {
    // Below High the 9B is skipped for its tier, and on an 8 GB Mac the 4B too: the agent runs on the 0.8B, and
    // vision has nothing.
    agent: { chain: [local.agentLarge, local.agent, local.agentSmall] },
    router: { chain: [local.router] },
    vision: { chain: [local.visionLarge, local.vision] },
    embeddings: { chain: [local.embeddings] },
    speech: { chain: [local.parakeet, local.whisper] },
    // No local voice at parity yet, and no local image generation in v1 (PRD 8.2).
    voice: { chain: [] },
    music: { chain: [local.music] },
    images: { chain: [] },
  }),
];
