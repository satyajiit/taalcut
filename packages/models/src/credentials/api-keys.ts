// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Checks an API key before it is stored (P1-F4): one tiny request to the
 * provider's cheapest chat model, through the same ModelClient as real calls,
 * so it is logged as a cloud call like any other. Answers that prove the key
 * authenticated (rate limit, no credit, unknown model) count as valid.
 */
import { err, ok, type AsyncResult, type CloudCallSink } from '@taalcut/core';
import type { FetchFn } from '../client/http-meter';
import { createModelClient } from '../client/model-client';
import { ApiKeyInvalid } from '../errors';
import type { ModelRuntime } from '../runtime/runtime';
import { createStaticCredentialProvider } from './credential-provider';

/** Resolves ok when the provider accepts the key. */
export type ApiKeyTester = (provider: string, key: string, signal?: AbortSignal) => AsyncResult<void>;

export interface KeyTesterDeps {
  readonly runtime: ModelRuntime;
  readonly callLog: CloudCallSink;
  readonly fetch?: FetchFn;
  /** Model to test with, per provider. Default: the provider's cheapest chat model. */
  readonly testModels?: Readonly<Record<string, string>>;
}

/** The key reached the account: what failed is the account's limits, not the key. */
const AUTHENTICATED = new Set(['models.rate_limited', 'models.quota_exceeded', 'models.unknown_model']);
const REJECTED = new Set(['models.auth_invalid', 'models.auth_expired', 'models.not_configured']);

export function createKeyTester(deps: KeyTesterDeps): ApiKeyTester {
  return async (provider, key, signal) => {
    const model = deps.testModels?.[provider] ?? cheapestChatModel(deps.runtime, provider);
    // Nothing to call (a provider with only image or classifier models): store untested.
    if (!model) return ok(undefined);
    const client = createModelClient({
      runtime: deps.runtime,
      credentials: createStaticCredentialProvider({
        [provider]: { kind: 'api_key', secret: key, source: 'key test' },
      }),
      callLog: deps.callLog,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      retry: { maxRetries: 0, timeoutMs: 20_000 },
    });
    const result = await client.complete({
      module: 'agent',
      target: { provider, model, reasoning: 'off' },
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      maxTokens: 16,
      ...(signal ? { signal } : {}),
    });
    if (result.ok || AUTHENTICATED.has(result.error.code)) return ok(undefined);
    if (REJECTED.has(result.error.code))
      return err(ApiKeyInvalid({ provider }, result.error.detail ? { detail: result.error.detail } : {}));
    return err(result.error);
  };
}

function cheapestChatModel(runtime: ModelRuntime, provider: string): string | undefined {
  const price = (m: { price: { input: number; output: number } }) => m.price.input + m.price.output;
  return runtime
    .listModels(provider)
    .filter((m) => m.kind === 'chat')
    .sort((a, b) => price(a) - price(b) || a.id.localeCompare(b.id))[0]?.id;
}
