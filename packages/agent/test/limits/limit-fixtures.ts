// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Limits, prices and a client that falls back on its own, for the G8 tests. */
import type { TaalcutError, UsageLimit } from '@taalcut/core';
import { createScriptedModelClient, type ScriptedReply } from '@taalcut/agent';
import {
  ModelQuotaExceeded,
  ModelRateLimited,
  type ModelClient,
  type ModelEvent,
  type ModulePrice,
  type PriceLookup,
} from '@taalcut/models';

const price = (
  provider: string,
  model: string,
  input: number,
  output: number,
  local = false,
): ModulePrice => ({
  module: 'agent',
  provider,
  model,
  local,
  usdPerMTok: { input, output, cacheRead: 0 },
});

/** The agent module's options: OpenAI first (the limited one), then Anthropic, Google, and one on this Mac. */
export const PRICES: PriceLookup = {
  price: () => price('openai', 'gpt-5.4', 2, 8),
  options: () => [
    price('on-device', 'qwen3.5-4b', 0, 0, true),
    price('openai', 'gpt-5.4', 2, 8),
    price('anthropic', 'claude-sonnet-5', 3, 15),
    price('google', 'gemini-3.6-flash', 0.3, 2.5),
  ],
};

/** Google is limited too. */
export const LIMITED: UsageLimit = {
  provider: 'google',
  modules: ['agent'],
  kind: 'rate',
  since: 0,
  resetsAt: null,
  waiting: [],
};

export const rateLimited = (resetsAt: number): ScriptedReply => ({
  error: ModelRateLimited({ provider: 'openai', model: 'gpt-5.4', resetsAt }),
});

export const quotaUsedUp = (): ScriptedReply => ({
  error: ModelQuotaExceeded({ provider: 'openai', model: 'gpt-5.4' }),
});

/** A client that met OpenAI's rate limit (or `reason`) and moved on to Anthropic by itself, which answered. */
export function fallbackClient(
  reason: TaalcutError = ModelRateLimited({ provider: 'openai', model: 'gpt-5.4', retryAfterMs: 30_000 }),
): ModelClient {
  const inner = createScriptedModelClient(() => ({
    text: 'Done.',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
  }));
  const fallback: ModelEvent = {
    type: 'fallback',
    from: { provider: 'openai', model: 'gpt-5.4' },
    to: { provider: 'anthropic', model: 'claude-sonnet-5' },
    reason,
  };
  const client: ModelClient = {
    stream(request) {
      const base = inner.stream(request);
      return {
        async *[Symbol.asyncIterator]() {
          yield fallback;
          yield* base;
        },
        result: () => base.result(),
      };
    },
    complete: (request) => client.stream(request).result(),
  };
  return client;
}
