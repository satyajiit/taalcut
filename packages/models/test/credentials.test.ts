// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The auth token flow: the main process's broker keeps refresh tokens in the
 * SecretStore and hands the agent process only API keys and short-lived access
 * tokens, which the agent side caches until expiry.
 */
import { err, ok } from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthBroker,
  createCachingCredentialProvider,
  createMemorySecretStore,
  createModelRuntime,
  disableNetwork,
  SecretStoreFailed,
  type ResolvedCredential,
  type SecretStore,
} from '@taalcut/models';
import { createHarness, type Harness } from './support/harness';

const ACCESS = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.YWNjZXNzLXRva2VuLXNpZ25hdHVyZQ';
const REFRESH = 'rt_refresh-token-that-must-never-leave-main-0123456789';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function brokerWith(credential: unknown, store: SecretStore = createMemorySecretStore()) {
  if (credential) await store.set('models.credential.openai', JSON.stringify(credential));
  const runtime = createModelRuntime({ secrets: store, builtinProviders: ['openai', 'anthropic'] });
  return { broker: createAuthBroker({ runtime, openExternal: () => undefined }), store };
}

describe('auth broker (main process)', () => {
  it('hands out a sign-in access token and its expiry, never the refresh token', async () => {
    const expires = Date.now() + 60 * 60 * 1000;
    const { broker } = await brokerWith({ type: 'oauth', access: ACCESS, refresh: REFRESH, expires });
    const result = await broker.get('openai');
    expect(result).toEqual(ok({ kind: 'oauth_access', secret: ACCESS, expiresAt: expires, source: 'OAuth' }));
    expect(JSON.stringify(result)).not.toContain(REFRESH);
    const status = await broker.status('openai');
    expect(status).toMatchObject(ok({ signedIn: true, method: 'subscription', expiresAt: expires }));
    expect(JSON.stringify(status)).not.toContain(REFRESH);
    expect(JSON.stringify(status)).not.toContain(ACCESS);
  });

  it('reports an expired sign-in that cannot refresh offline as models.auth_expired and keeps it', async () => {
    const { broker, store } = await brokerWith({
      type: 'oauth',
      access: ACCESS,
      refresh: REFRESH,
      expires: Date.now() - 1000,
      clientId: 'issued-client-1',
    });
    const guard = disableNetwork();
    try {
      const result = await broker.get('openai');
      expect(!result.ok && result.error).toMatchObject({ code: 'models.auth_expired', retryable: true });
      expect(!result.ok && result.error.detail).not.toContain(REFRESH);
    } finally {
      guard.restore();
    }
    expect((await store.get('models.credential.openai')).ok).toBe(true);
    expect(JSON.stringify(await store.get('models.credential.openai'))).toContain(REFRESH);
  });

  it('stores API keys in the SecretStore and signs out', async () => {
    const { broker, store } = await brokerWith(undefined);
    expect(await broker.get('openai')).toEqual(ok(undefined));
    expect(await broker.status('openai')).toEqual(
      ok({ provider: 'openai', signedIn: false, planLabelKey: 'models.account.notConnected' }),
    );
    const key = 'sk-proj-vault-key-0123456789abcdef';
    expect(await broker.setApiKey('openai', key, { skipTest: true })).toEqual(
      ok({
        provider: 'openai',
        signedIn: true,
        method: 'api_key',
        planLabelKey: 'models.account.usingApiKey',
      }),
    );
    expect(await broker.get('openai')).toEqual(
      ok({ kind: 'api_key', secret: key, source: 'stored credential' }),
    );
    expect(JSON.stringify(await store.get('models.credential-index'))).toContain('openai');
    await broker.signOut('openai');
    expect(await store.get('models.credential.openai')).toEqual(ok(undefined));
    expect(JSON.stringify(await broker.statuses())).not.toContain(key);
  });

  it('turns a keychain failure into models.secret_store_failed', async () => {
    const failing: SecretStore = {
      get: async () => err(SecretStoreFailed({ operation: 'get' })),
      set: async () => err(SecretStoreFailed({ operation: 'set' })),
      delete: async () => err(SecretStoreFailed({ operation: 'delete' })),
    };
    const { broker } = await brokerWith(undefined, failing);
    expect(await broker.get('openai')).toMatchObject({
      ok: false,
      error: { code: 'models.secret_store_failed' },
    });
    expect(await broker.setApiKey('openai', 'sk-proj-0123456789abcdef', { skipTest: true })).toMatchObject({
      ok: false,
      error: { code: 'models.secret_store_failed' },
    });
  });

  it('feeds the agent-side client end to end', async () => {
    const { broker } = await brokerWith(undefined);
    await broker.setApiKey('anthropic', 'sk-ant-api-key-from-the-vault-0123456789', { skipTest: true });
    h = await createHarness({ credentials: createCachingCredentialProvider({ source: broker }) });
    const result = await h.client.complete({
      module: 'agent',
      target: { provider: 'anthropic', model: 'claude-sonnet-5' },
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(result.ok).toBe(true);
    expect(h.server.requests[0]?.headers['x-api-key']).toBe('sk-ant-api-key-from-the-vault-0123456789');
  });
});

describe('caching credential provider (agent process)', () => {
  const token = (expiresAt: number): ResolvedCredential => ({
    kind: 'oauth_access',
    secret: ACCESS,
    expiresAt,
    source: 'OAuth',
  });

  it('reuses a token until it is about to expire, then fetches a fresh one', async () => {
    let now = 1_000_000;
    const source = { get: vi.fn(async () => ok(token(now + 10 * 60_000))) };
    const cache = createCachingCredentialProvider({ source, now: () => now });
    await cache.get('openai');
    await cache.get('openai');
    expect(source.get).toHaveBeenCalledTimes(1);
    now += 9.5 * 60_000; // 30 s left, less than the 60 s minimum validity
    await cache.get('openai');
    expect(source.get).toHaveBeenCalledTimes(2);
  });

  it('after a 401 asks the source for a forced refresh once; forget() just drops the copy', async () => {
    const source = { get: vi.fn(async () => ok(token(Date.now() + 60 * 60_000))) };
    const cache = createCachingCredentialProvider({ source });
    await cache.get('openai');
    cache.invalidate('openai');
    await cache.get('openai');
    expect(source.get).toHaveBeenLastCalledWith('openai', { minValidityMs: 60_000, forceRefresh: true });
    cache.forget('openai');
    await cache.get('openai');
    expect(source.get).toHaveBeenLastCalledWith('openai', { minValidityMs: 60_000 });
    expect(source.get).toHaveBeenCalledTimes(3);
  });

  it('does not cache misses or failures', async () => {
    const source = { get: vi.fn(async () => ok<ResolvedCredential | undefined>(undefined)) };
    const cache = createCachingCredentialProvider({ source });
    await cache.get('openai');
    await cache.get('openai');
    expect(source.get).toHaveBeenCalledTimes(2);
  });
});
