// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-AGT: what the browser hears when a ChatGPT sign-in comes back. "You're signed in" only once the tokens
 * are issued; a failed exchange, a declined consent, a stale tab and a browser that comes back after the
 * timeout each get their own page; and no page ever carries the code, the state or a token.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAccountsHarness, type AccountsHarness } from './support/accounts';

let h: AccountsHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/** Opens nothing: the test plays the browser, with the authorize URL Taalcut opened. */
function capturingBrowser() {
  const urls: URL[] = [];
  return {
    open: (url: string) => void urls.push(new URL(url)),
    async next(): Promise<URL> {
      while (urls.length === 0) await new Promise((r) => setTimeout(r, 5));
      return urls.shift()!;
    },
  };
}

/** The consent step: where the provider sends the browser back to, with the code and the state. */
async function approve(authorize: URL): Promise<URL> {
  const approved = await fetch(authorize, { redirect: 'manual' });
  return new URL(approved.headers.get('location')!);
}

function expectNothingEchoed(html: string, callback: URL): void {
  for (const name of ['code', 'state', 'client_id']) {
    const value = callback.searchParams.get(name);
    if (value) expect(html, name).not.toContain(value);
  }
  expect(html).not.toMatch(/<script/i);
}

describe('the page a sign-in’s browser comes back to', () => {
  it('says signed in only after the tokens are issued', async () => {
    const browser = capturingBrowser();
    h = await createAccountsHarness({ openExternal: browser.open });
    const signingIn = h.broker.signIn('openai');
    const callback = await approve(await browser.next());
    const page = await fetch(callback);
    // The browser was answered while the sign-in finished, not before the code was exchanged.
    expect(h.oauth.tokenRequests.map((r) => r.get('grant_type'))).toEqual(['authorization_code']);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('You’re signed in');
    expect(html).toContain('You can close this tab and return to Taalcut.');
    expectNothingEchoed(html, callback);
    for (const issued of h.oauth.issued) {
      expect(html).not.toContain(issued.access);
      expect(html).not.toContain(issued.refresh);
    }
    expect(await signingIn).toMatchObject({ ok: true, value: { signedIn: true } });
  });

  it('says the exchange failed when OpenAI refuses the code, and keeps nothing', async () => {
    const browser = capturingBrowser();
    h = await createAccountsHarness({ openExternal: browser.open });
    const signingIn = h.broker.signIn('openai');
    const callback = await approve(await browser.next());
    // A code the token endpoint doesn't know: invalid_grant.
    callback.searchParams.set('code', 'not-a-code-it-issued');
    const page = await fetch(callback);
    expect(page.status).toBe(502);
    const html = await page.text();
    expect(html).toContain('Sign-in didn’t finish');
    expect(html).toContain('couldn’t get access from OpenAI');
    expectNothingEchoed(html, callback);
    expect(await signingIn).toMatchObject({ ok: false, error: { code: 'models.sign_in_failed' } });
    expect(h.secrets.entries.has('models.credential.openai')).toBe(false);
  });

  it('tells a stale tab it is out of date and keeps waiting for the real one', async () => {
    const browser = capturingBrowser();
    h = await createAccountsHarness({ openExternal: browser.open });
    const signingIn = h.broker.signIn('openai');
    const callback = await approve(await browser.next());
    const stale = new URL(callback);
    stale.searchParams.set('state', 'from-an-older-sign-in');
    const page = await fetch(stale);
    expect(page.status).toBe(400);
    const html = await page.text();
    expect(html).toContain('This sign-in link is out of date');
    expectNothingEchoed(html, stale);
    expect((await fetch(callback)).status).toBe(200);
    expect(await signingIn).toMatchObject({ ok: true });
  });

  it('tells a browser that comes back after the timeout that it timed out', async () => {
    const browser = capturingBrowser();
    h = await createAccountsHarness({
      openExternal: browser.open,
      chatgpt: { timeoutMs: 200, lateWindowMs: 5_000 },
    });
    const signingIn = h.broker.signIn('openai');
    const authorize = await browser.next();
    expect(await signingIn).toMatchObject({ ok: false, error: { code: 'models.sign_in_timeout' } });

    const callback = await approve(authorize);
    const page = await fetch(callback);
    expect(page.status).toBe(408);
    const html = await page.text();
    expect(html).toContain('This sign-in timed out');
    expectNothingEchoed(html, callback);
    // The late code is never exchanged, and nothing is kept.
    expect(h.oauth.tokenRequests).toHaveLength(0);
    expect(h.secrets.entries.has('models.credential.openai')).toBe(false);

    // A new sign-in takes over from the late page at once.
    const again = h.broker.signIn('openai');
    const next = await approve(await browser.next());
    expect((await fetch(next)).status).toBe(200);
    expect(await again).toMatchObject({ ok: true });
    await expect(fetch(callback)).rejects.toThrow();
  });
});
