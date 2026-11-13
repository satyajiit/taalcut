// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-F4 done when: an API key is checked with a cheap test call before it is
 * stored, lives only in the SecretStore, never reaches status, errors or logs,
 * and a key added (or changed) is used on the very next call.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelRequest } from '@taalcut/models';
import { createAccountsHarness, type AccountsHarness } from './support/accounts';

const GOOD_KEY = 'sk-proj-good-key-0123456789abcdefghij';
const BAD_KEY = 'sk-proj-bad-key-0123456789abcdefghijk';
const CALL: ModelRequest = {
  module: 'agent',
  target: { provider: 'openai', model: 'gpt-5.4' },
  messages: [{ role: 'user', content: 'Hi' }],
};

let h: AccountsHarness;
afterEach(async () => {
  await h.close();
});

describe('API keys (P1-F4)', () => {
  it('rejects a key the provider refuses, stores nothing, and keeps the key out of the error', async () => {
    h = await createAccountsHarness();
    h.provider.script('openai', {
      kind: 'error',
      status: 401,
      message: `Incorrect API key provided: ${BAD_KEY}`,
    });
    const result = await h.broker.setApiKey('openai', BAD_KEY);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'models.api_key_invalid', fix: { command: 'settings.openAccounts' } },
    });
    expect(JSON.stringify(result)).not.toContain(BAD_KEY);
    expect(h.secrets.entries.has('models.credential.openai')).toBe(false);
    // The test call is a cloud call like any other, and its row holds no key.
    expect(h.keyTestLog.records).toHaveLength(1);
    expect(h.keyTestLog.records[0]).toMatchObject({ provider: 'openai', outcome: 'error', httpStatus: 401 });
  });

  it('tests a good key with one tiny request to the cheapest model, then stores it', async () => {
    h = await createAccountsHarness();
    const result = await h.broker.setApiKey('openai', `  ${GOOD_KEY}\n`);
    expect(result).toEqual({
      ok: true,
      value: {
        provider: 'openai',
        signedIn: true,
        method: 'api_key',
        planLabelKey: 'models.account.usingApiKey',
      },
    });
    const test = h.provider.requests[0]!;
    expect(test.headers.authorization).toBe(`Bearer ${GOOD_KEY}`);
    expect(test.body.max_output_tokens).toBeLessThanOrEqual(16);
    const cheapest = h.mainRuntime
      .listModels('openai')
      .filter((m) => m.kind === 'chat')
      .reduce((a, b) => (a.price.input + a.price.output <= b.price.input + b.price.output ? a : b));
    expect(test.body.model).toBe(cheapest.id);
    expect(h.secrets.entries.get('models.credential.openai')).toContain(GOOD_KEY);
  });

  it('counts a rate-limited or out-of-credit answer as a valid key', async () => {
    h = await createAccountsHarness();
    h.provider.script('openai', { kind: 'error', status: 429, message: 'Rate limit reached' });
    expect((await h.broker.setApiKey('openai', GOOD_KEY)).ok).toBe(true);
    h.provider.script('anthropic', { kind: 'error', status: 400, message: 'Your credit balance is too low' });
    expect((await h.broker.setApiKey('anthropic', 'sk-ant-api03-key-0123456789abcdef')).ok).toBe(true);
  });

  it('uses a key on the next call after it is added or changed', async () => {
    h = await createAccountsHarness();
    expect(await h.client.complete(CALL)).toMatchObject({
      ok: false,
      error: { code: 'models.not_configured' },
    });

    await h.broker.setApiKey('openai', GOOD_KEY, { skipTest: true });
    expect((await h.client.complete(CALL)).ok).toBe(true);
    expect(h.provider.requests.at(-1)?.headers.authorization).toBe(`Bearer ${GOOD_KEY}`);

    const rotated = 'sk-proj-rotated-key-0123456789abcdefgh';
    await h.broker.setApiKey('openai', rotated, { skipTest: true });
    expect((await h.client.complete(CALL)).ok).toBe(true);
    expect(h.provider.requests.at(-1)?.headers.authorization).toBe(`Bearer ${rotated}`);

    await h.broker.signOut('openai');
    expect(await h.client.complete(CALL)).toMatchObject({
      ok: false,
      error: { code: 'models.not_configured' },
    });
  });

  it('scrubs keys it has handled from log text, whatever their shape', async () => {
    h = await createAccountsHarness();
    const odd = 'plain-looking-key-without-a-known-prefix';
    await h.broker.setApiKey('anthropic', odd, { skipTest: true });
    const line = h.broker.scrub(`request failed for key=${odd} and ${GOOD_KEY}`);
    expect(line).not.toContain(odd);
    expect(line).not.toContain(GOOD_KEY);
    expect(line).toContain('[REDACTED]');
  });

  it('refuses empty keys and providers that take none', async () => {
    h = await createAccountsHarness();
    expect(await h.broker.setApiKey('openai', '   ')).toMatchObject({
      ok: false,
      error: { code: 'models.api_key_invalid' },
    });
    expect(await h.broker.setApiKey('no-such-provider', GOOD_KEY)).toMatchObject({
      ok: false,
      error: { code: 'models.api_key_invalid' },
    });
  });
});
