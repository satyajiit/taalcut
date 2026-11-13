// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-F3 done when: against a mock OAuth server, sign in with ChatGPT, make a
 * model call, force the token to expire, watch it refresh, call again; and no
 * access token, refresh token, id token, code or PKCE verifier shows up in the
 * account status, any cloud-call record, any error detail or any log output.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaalcutError } from '@taalcut/core';
import type { ModelRequest } from '@taalcut/models';
import { createAccountsHarness, type AccountsHarness } from './support/accounts';
import { ACCOUNT_EMAIL } from '@taalcut/models/test-support';

const CALL: ModelRequest = {
  module: 'agent',
  target: { provider: 'openai', model: 'gpt-5.4' },
  messages: [{ role: 'user', content: 'Hi' }],
  temperature: 0.4,
  maxTokens: 200,
};
const HOUR = 60 * 60 * 1000;

let h: AccountsHarness;
let output: string[];

beforeEach(async () => {
  output = [];
  // Everything any code under test logs, by any route.
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
  }
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream);
    vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      output.push(String(chunk));
      return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write);
  }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 9, 12, 9, 0, 0));
  h = await createAccountsHarness();
  // The mock provider takes only live access tokens, like api.openai.com.
  h.provider.setAuthCheck((headers) =>
    h.oauth.isValidAccess(headers.authorization?.replace(/^Bearer /, '') ?? undefined),
  );
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await h.close();
});

const bearer = (index: number) => h.provider.requests[index]?.headers.authorization;

describe('Continue with ChatGPT (P1-F3)', () => {
  it('signs in, calls, refreshes an expired token, calls again, and leaks no token anywhere', async () => {
    const errors: TaalcutError[] = [];
    expect(await h.broker.status('openai')).toMatchObject({ ok: true, value: { signedIn: false } });

    // 1. Sign in through the system browser and the loopback callback.
    const signedIn = await h.broker.signIn('openai');
    expect(signedIn).toEqual({
      ok: true,
      value: {
        provider: 'openai',
        signedIn: true,
        method: 'subscription',
        planLabelKey: 'models.account.chatgpt.usingPlan',
        accountLabel: ACCOUNT_EMAIL,
        expiresAt: Date.now() + HOUR - 3 * 60_000,
        manageUsageUrl: 'https://chatgpt.com/settings/usage',
      },
    });
    const authorize = h.oauth.authorizeRequests[0]!;
    expect(Object.fromEntries(authorize)).toMatchObject({
      client_id: 'dynamic_agent_client',
      agent_name_hint: 'Taalcut',
      response_type: 'code',
      code_challenge_method: 'S256',
      resource: 'https://api.openai.com/v1',
    });
    expect(authorize.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    // The browser reads the page after the sign-in has already ended.
    while (h.browser.pages.length === 0) await new Promise((r) => setTimeout(r, 5));
    expect(h.browser.pages[0]).toMatchObject({ status: 200 });
    expect(h.browser.pages[0]?.html).toContain('You’re signed in');
    expect(h.events).toContainEqual({ type: 'browser_opened', provider: 'openai' });

    // 2. A call billed to the plan: bearer access token, store:false, stream:true.
    const first = await h.client.complete(CALL);
    expect(first.ok).toBe(true);
    const [access1, refresh1] = [h.oauth.issued[0]!.access, h.oauth.issued[0]!.refresh];
    expect(bearer(0)).toBe(`Bearer ${access1}`);
    expect(h.provider.requests[0]?.body).toMatchObject({ store: false, stream: true });
    expect(h.provider.requests[0]?.body).not.toHaveProperty('temperature');
    expect(h.provider.requests[0]?.body).not.toHaveProperty('max_output_tokens');

    // 3. Two hours later the token has expired: the next call refreshes it first.
    vi.setSystemTime(Date.now() + 2 * HOUR);
    h.oauth.expireAccessTokens();
    const second = await h.client.complete(CALL);
    expect(second.ok).toBe(true);
    const refreshGrant = h.oauth.tokenRequests.at(-1)!;
    expect(refreshGrant.get('grant_type')).toBe('refresh_token');
    expect(refreshGrant.get('refresh_token')).toBe(refresh1);
    expect(refreshGrant.get('client_id')).toBe('issued-client-1');
    expect(bearer(1)).toBe(`Bearer ${h.oauth.issued[1]!.access}`);

    // 4. The provider revokes the token early: the 401 forces a refresh and one retry.
    h.oauth.expireAccessTokens();
    const third = await h.client.complete(CALL);
    expect(third.ok).toBe(true);
    expect(h.callLog.records.slice(-2)).toMatchObject([
      { outcome: 'error', errorCode: 'models.auth_expired', httpStatus: 401, attempt: 1 },
      { outcome: 'ok', attempt: 2 },
    ]);
    expect(bearer(3)).toBe(`Bearer ${h.oauth.issued[2]!.access}`);

    // 5. The plan ends: refresh is refused, and the user is asked to sign in again.
    h.oauth.revokeRefreshTokens();
    vi.setSystemTime(Date.now() + 2 * HOUR);
    const fourth = await h.client.complete(CALL);
    expect(!fourth.ok && fourth.error).toMatchObject({ code: 'models.sign_in_required' });
    if (!fourth.ok) errors.push(fourth.error);

    // 6. Sign out removes the refresh token from the keychain.
    const statuses = await h.broker.statuses();
    expect(await h.broker.signOut('openai')).toEqual({ ok: true, value: undefined });
    expect(await h.broker.status('openai')).toMatchObject({ ok: true, value: { signedIn: false } });
    expect([...h.secrets.entries.keys()]).not.toContain('models.credential.openai');

    // No secret anywhere the renderer, the database or a log could see it.
    const exposed = JSON.stringify({
      signedIn,
      statuses,
      records: h.callLog.records,
      errors,
      events: h.events,
      output,
    });
    const secrets = h.oauth.secrets();
    expect(secrets.length).toBeGreaterThan(10);
    for (const secret of secrets) expect(exposed).not.toContain(secret);
  });

  it('keeps the refresh token in the SecretStore and nowhere in what get() returns', async () => {
    await h.broker.signIn('openai');
    const stored = h.secrets.entries.get('models.credential.openai') ?? '';
    expect(stored).toContain(h.oauth.issued[0]!.refresh);
    expect(stored).not.toContain(h.oauth.issued[0]!.idToken);
    const credential = await h.broker.get('openai');
    expect(credential).toMatchObject({
      ok: true,
      value: { kind: 'oauth_access', secret: h.oauth.issued[0]!.access },
    });
    expect(JSON.stringify(credential)).not.toContain(h.oauth.issued[0]!.refresh);
    expect(h.secrets.entries.get('models.device-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('enforces store:false and stream:true even when a later pi-ai would send otherwise', async () => {
    await h.broker.signIn('openai');
    await h.client.complete({ ...CALL, maxTokens: undefined, temperature: undefined });
    expect(h.provider.requests[0]?.body).toMatchObject({ store: false, stream: true });
  });
});
