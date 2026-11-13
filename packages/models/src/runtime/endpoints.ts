// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * OpenAI-compatible local servers as pi-ai providers: the embedded local
 * runtime the app runs (D16), and, under Advanced only, a server the user runs
 * themselves (Ollama, LM Studio, vLLM, llama.cpp). They speak Chat
 * Completions; most don't know the `developer` role or the `store` field, so
 * the compat flags turn those off.
 */
import { createProvider, type Model, type Provider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { ComputeBackend } from '../hardware/compute';

export interface LocalModelSpec {
  readonly id: string;
  readonly name?: string;
  /** The model can think (Qwen3, gpt-oss). 'off' then maps to reasoning_effort "none". */
  readonly reasoning?: boolean;
  /** The model accepts images (Qwen3-VL, Gemma 4). */
  readonly vision?: boolean;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  /**
   * For reasoning models whose chat template switches thinking with a kwarg
   * ('enable_thinking' for Qwen3 and Qwen3.5 on llama.cpp): sent in
   * `chat_template_kwargs` on every call, false when reasoning is 'off'.
   */
  readonly thinkingKwarg?: string;
}

export interface LocalEndpoint {
  /** Provider id used in profiles, e.g. 'ollama'. */
  readonly id: string;
  readonly name: string;
  /** Base URL including /v1, e.g. 'http://127.0.0.1:11434/v1'. */
  readonly baseUrl: string;
  readonly models: readonly LocalModelSpec[];
  /** Accept model ids that aren't listed (models the user pulled), with conservative defaults. */
  readonly acceptUnlisted?: boolean;
  /** Override the loopback check, e.g. for a GPU box on the LAN (not local, not cloud). */
  readonly local?: boolean;
  /**
   * Where the server runs its models, accelerated first (ADR 0002), e.g.
   * ['mlx'] for LM Studio's MLX engine. Unset when unknown (a user's own server).
   */
  readonly compute?: readonly ComputeBackend[];
  /**
   * A key the server requires, sent as the bearer token: the embedded
   * runtime's per-launch key. Never listed back (ModelRuntime.listEndpoints).
   */
  readonly apiKey?: string;
}

export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
export const LM_STUDIO_DEFAULT_BASE_URL = 'http://127.0.0.1:1234/v1';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isLocalEndpoint(endpoint: LocalEndpoint): boolean {
  return endpoint.local ?? isLoopbackUrl(endpoint.baseUrl);
}

/** pi-ai model metadata for a model served by a local endpoint. Local inference costs nothing per token. */
export function localModel(endpoint: LocalEndpoint, spec: LocalModelSpec): Model<'openai-completions'> {
  const reasoning = spec.reasoning ?? false;
  const kwarg = reasoning ? spec.thinkingKwarg : undefined;
  return {
    id: spec.id,
    name: spec.name ?? spec.id,
    api: 'openai-completions',
    provider: endpoint.id,
    baseUrl: endpoint.baseUrl,
    reasoning,
    input: spec.vision ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: spec.contextWindow ?? 32_768,
    maxTokens: spec.maxTokens ?? 4_096,
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsStrictMode: false,
      supportsReasoningEffort: reasoning && !kwarg,
      // pi-ai fills thinking.enabled from the call's reasoning level.
      ...(kwarg
        ? { thinkingFormat: 'chat-template', chatTemplateKwargs: { [kwarg]: { $var: 'thinking.enabled' } } }
        : {}),
    },
    ...(reasoning && !kwarg ? { thinkingLevelMap: { off: 'none' } } : {}),
  };
}

export function localEndpointProvider(endpoint: LocalEndpoint): Provider {
  return createProvider({
    id: endpoint.id,
    name: endpoint.name,
    baseUrl: endpoint.baseUrl,
    // Keyless servers count as configured. A key stored for the endpoint (LM Studio can require
    // one) is used when present.
    auth: {
      apiKey: {
        name: endpoint.name,
        resolve: async ({ credential }) =>
          credential?.key
            ? { auth: { apiKey: credential.key }, source: 'stored credential' }
            : endpoint.apiKey
              ? { auth: { apiKey: endpoint.apiKey }, source: 'endpoint key' }
              : { auth: {}, source: 'keyless' },
      },
    },
    models: endpoint.models.map((spec) => localModel(endpoint, spec)),
    api: openAICompletionsApi(),
  });
}
