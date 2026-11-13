// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The sign-in's one call into the system browser (security review SB-5): a URL pi-ai's flow hands over is
 * opened only when it is https, or http on loopback; anything else ends the sign-in with
 * models.sign_in_failed and nothing is opened.
 */
import type { AuthInteraction, Credential } from '@earendil-works/pi-ai';
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { runSignIn, type SignInModels } from '../src/signin/sign-in';

/** A provider whose flow announces one URL (or device page) and then waits until the sign-in stops it. */
function fakeModels(event: Parameters<AuthInteraction['notify']>[0]): SignInModels {
  return {
    getProvider: () => ({ auth: { oauth: {} } }),
    login: (_provider, _kind, interaction) =>
      new Promise<Credential>((resolve, reject) => {
        interaction.notify(event);
        const signal = interaction.signal;
        if (signal?.aborted) return reject(signal.reason);
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        // A URL that went out: the flow finishes on its own, as a browser callback would.
        setTimeout(() => resolve({ type: 'oauth', access: 'a', refresh: 'r', expires: 0 }), 20);
      }),
  };
}

async function signIn(event: Parameters<AuthInteraction['notify']>[0]) {
  const opened: string[] = [];
  const result = await runSignIn(
    {
      models: fakeModels(event),
      openExternal: (url) => void opened.push(url),
      deviceId: () => Promise.resolve(ok('device-1')),
      agentName: 'Taalcut',
      timeoutMs: 5_000,
      secrets: () => [],
    },
    'openai',
    {},
  );
  return { result, opened };
}

describe('the sign-in opens only https or loopback pages (SB-5)', () => {
  it.each([
    'http://auth.openai.com/authorize?state=x',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'x-apple.systempreferences:com.apple.preference.security',
    'ssh://example.com',
    'http://192.168.1.10:1455/auth',
    'not a url',
  ])('refuses %s', async (url) => {
    const { result, opened } = await signIn({ type: 'auth_url', url });
    expect(opened).toEqual([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('models.sign_in_failed');
  });

  it('refuses a device-code page that is not https', async () => {
    const { result, opened } = await signIn({
      type: 'device_code',
      userCode: 'ABCD-EFGH',
      verificationUri: 'http://github.com/login/device',
    });
    expect(opened).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it.each([
    'https://auth.openai.com/authorize?state=x',
    'http://127.0.0.1:1455/auth',
    'http://localhost:1455/x',
  ])('opens %s', async (url) => {
    const { result, opened } = await signIn({ type: 'auth_url', url });
    expect(opened).toEqual([url]);
    expect(result.ok).toBe(true);
  });
});
