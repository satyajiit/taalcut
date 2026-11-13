// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The loopback callback and the ways a browser sign-in ends without a token. */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccountsHarness, type AccountsHarness } from './support/accounts';

let h: AccountsHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/** Opens nothing; returns the authorize URL's redirect_uri and state for the test to play browser. */
function capturingBrowser() {
  const urls: URL[] = [];
  return {
    urls,
    open: (url: string) => void urls.push(new URL(url)),
    async next(): Promise<URL> {
      while (urls.length === 0) await new Promise((r) => setTimeout(r, 5));
      return urls.shift()!;
    },
  };
}

describe('browser sign-in callback', () => {
  it('ignores a wrong state, accepts the right one once, and serves a static page', async () => {
    const browser = capturingBrowser();
    h = await createAccountsHarness({ openExternal: browser.open });
    const signingIn = h.broker.signIn('openai');
    const authorize = await browser.next();
    const redirect = authorize.searchParams.get('redirect_uri')!;
    const state = authorize.searchParams.get('state')!;

    const forged = await fetch(`${redirect}?code=x&state=forged&client_id=c`);
    expect(forged.status).toBe(400);
    const forgedHtml = await forged.text();
    expect(forgedHtml).not.toContain('forged');
    expect(forgedHtml).not.toMatch(/<script/i);
    expect(forgedHtml).toContain('This sign-in link is out of date');
    expect(forged.headers.get('content-security-policy')).toMatch(/^default-src 'none'; style-src 'sha256-/);

    // The real authorize step, which also issues the code the token endpoint will accept.
    const approved = await fetch(authorize, { redirect: 'manual' });
    const callback = await fetch(approved.headers.get('location')!);
    expect(callback.status).toBe(200);
    expect(await signingIn).toMatchObject({ ok: true, value: { signedIn: true } });

    // Single use: the server is gone once the sign-in finished.
    await expect(fetch(`${redirect}?code=again&state=${state}`)).rejects.toThrow();
  });

  it('maps a declined consent to models.sign_in_denied and stores nothing', async () => {
    h = await createAccountsHarness();
    h.oauth.denyNext();
    const result = await h.broker.signIn('openai');
    expect(result).toMatchObject({ ok: false, error: { code: 'models.sign_in_denied' } });
    // The browser reads the page after the sign-in has already ended.
    while (h.browser.pages.length === 0) await new Promise((r) => setTimeout(r, 5));
    expect(h.browser.pages[0]?.status).toBe(400);
    expect(h.browser.pages[0]?.html).toContain('Sign-in was declined');
    expect(h.secrets.entries.has('models.credential.openai')).toBe(false);
  });

  it('gives up after the timeout with models.sign_in_timeout', async () => {
    h = await createAccountsHarness({
      openExternal: () => undefined,
      chatgpt: { timeoutMs: 150, lateWindowMs: 50 },
    });
    const result = await h.broker.signIn('openai');
    expect(result).toMatchObject({ ok: false, error: { code: 'models.sign_in_timeout', retryable: true } });
  });

  it('can be cancelled, and a second sign-in replaces the first', async () => {
    const browser = capturingBrowser();
    h = await createAccountsHarness({ openExternal: browser.open });
    const first = h.broker.signIn('openai');
    await browser.next();
    h.broker.cancelSignIn('openai');
    expect(await first).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });

    const second = h.broker.signIn('openai');
    await browser.next();
    const third = h.broker.signIn('openai');
    expect(await second).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    const authorize = await browser.next();
    const approved = await fetch(authorize, { redirect: 'manual' });
    await fetch(approved.headers.get('location')!);
    expect(await third).toMatchObject({ ok: true });
  });

  it('reports a busy fixed port as models.sign_in_port_busy', async () => {
    const squatter = createServer();
    await new Promise<void>((resolve) => squatter.listen(0, '127.0.0.1', resolve));
    const port = (squatter.address() as AddressInfo).port;
    try {
      h = await createAccountsHarness({ chatgpt: { callbackPort: port } });
      const result = await h.broker.signIn('openai');
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'models.sign_in_port_busy', params: { port } },
      });
    } finally {
      await new Promise((resolve) => squatter.close(resolve));
    }
  });

  it('refuses providers without a sign-in', async () => {
    h = await createAccountsHarness();
    expect(await h.broker.signIn('mistral')).toMatchObject({
      ok: false,
      error: { code: 'models.sign_in_unsupported' },
    });
  });
});
