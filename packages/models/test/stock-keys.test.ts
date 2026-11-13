// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V18's stock media keys in Settings → Accounts: kept in the keychain like model keys, listed apart from
 * them, tested by the stock provider's own check, and settable only for the providers this build uses.
 */
import { err, ok, type AccountsState } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createAccountsService,
  createAuthBroker,
  createMemorySecretStore,
  createModelRuntime,
  type ApiKeyTester,
} from '@taalcut/models';

const KEY = 'pexels-key-0123456789abcdef';

function setup(options: { readonly stockTest?: ApiKeyTester; readonly offered?: boolean } = {}) {
  const secrets = createMemorySecretStore();
  const runtime = createModelRuntime({ secrets, builtinProviders: ['openai'] });
  const offered = options.offered ?? true;
  const broker = createAuthBroker({
    runtime,
    openExternal: () => undefined,
    ...(offered ? { keyOnlyProviders: ['pexels'] } : {}),
  });
  const modelTests: string[] = [];
  const service = createAccountsService({
    broker,
    runtime,
    apiKeyProviders: ['openai'],
    testApiKey: async (provider) => {
      modelTests.push(provider);
      return ok(undefined);
    },
    ...(offered
      ? {
          stockKeys: [
            { provider: 'pexels' as const, test: options.stockTest ?? (async () => ok(undefined)) },
          ],
        }
      : {}),
    now: () => 1_760_000_000_000,
  });
  return { secrets, broker, service, modelTests };
}

const value = <T>(result: { ok: true; value: T } | { ok: false }): T => {
  if (!result.ok) throw new Error('expected ok');
  return result.value;
};
const stockRows = (state: AccountsState) => state.stockKeys;

describe('stock keys in Accounts', () => {
  it('lists every stock provider, settable only where this build uses it', async () => {
    const { service } = setup();
    expect(stockRows(value(await service.state()))).toEqual([
      { provider: 'pexels', configured: false, available: true },
      { provider: 'freesound', configured: false, available: false },
    ]);
  });

  it('stores a key in the keychain, apart from the model keys, and the broker reads it back', async () => {
    const { service, broker, secrets } = setup();
    const state = value(await service.setApiKey({ provider: 'pexels', key: KEY }));
    expect(stockRows(state)[0]).toEqual({ provider: 'pexels', configured: true, available: true });
    expect(state.apiKeys.map((row) => row.provider)).toEqual(['openai']);
    expect(JSON.stringify(state)).not.toContain(KEY);
    expect(value(await broker.get('pexels'))).toMatchObject({ kind: 'api_key', secret: KEY });
    expect([...secrets.entries.values()].some((stored) => stored.includes(KEY))).toBe(true);
  });

  it('tests a stock key with the stock provider’s own check, never a model call', async () => {
    const tested: string[] = [];
    const { service, modelTests } = setup({
      stockTest: async (provider, key) => {
        tested.push(`${provider}:${key}`);
        return err({ code: 'library.stock_key_invalid', messageKey: 'x', retryable: false });
      },
    });
    value(await service.setApiKey({ provider: 'pexels', key: KEY }));
    expect(value(await service.testApiKey({ provider: 'pexels' }))).toEqual({
      at: 1_760_000_000_000,
      ok: false,
      errorCode: 'library.stock_key_invalid',
    });
    expect(tested).toEqual([`pexels:${KEY}`]);
    expect(modelTests).toEqual([]);
    expect(stockRows(value(await service.state()))[0]?.lastCheck?.ok).toBe(false);
  });

  it('removes a stock key', async () => {
    const { service, broker } = setup();
    value(await service.setApiKey({ provider: 'pexels', key: KEY }));
    expect(stockRows(value(await service.removeApiKey({ provider: 'pexels' })))[0]?.configured).toBe(false);
    expect(value(await broker.get('pexels'))).toBeUndefined();
  });

  it('refuses a key for a stock provider this build doesn’t use', async () => {
    const { service } = setup({ offered: false });
    const refused = await service.setApiKey({ provider: 'pexels', key: KEY });
    expect(!refused.ok && refused.error.code).toBe('models.api_key_invalid');
    expect(stockRows(value(await service.state()))[0]).toEqual({
      provider: 'pexels',
      configured: false,
      available: false,
    });
  });
});
