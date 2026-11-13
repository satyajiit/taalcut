// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createExpiringCache } from '../src/cache/expiring-cache';
import { createInstallationTokens, signAppJwt, type AppCredentials } from '../src/github/app-token';

const TOKEN_FIXTURE = readFileSync(new URL('./fixtures/github-access-token.json', import.meta.url), 'utf8');
const EXPIRES_AT = Date.parse('2026-10-14T11:00:00Z');

/** A throwaway key in the encoding GitHub hands out (PKCS#1) or the one WebCrypto imports (PKCS#8). */
function keyPair(type: 'pkcs1' | 'pkcs8') {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type, format: 'pem' },
  });
}

function credentials(privateKeyPem: string): AppCredentials {
  return { appId: '12345', privateKeyPem, installationId: '99' };
}

function decodePart(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

async function verifies(publicKeyPem: string, jwt: string): Promise<boolean> {
  const [header, payload, signature] = jwt.split('.');
  const spki = Buffer.from(publicKeyPem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  const key = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    Buffer.from(signature ?? '', 'base64url'),
    new TextEncoder().encode(`${header}.${payload}`),
  );
}

describe('app token', () => {
  it.each(['pkcs1', 'pkcs8'] as const)(
    'signs an RS256 JWT with a %s key that expires within ten minutes',
    async (type) => {
      const pair = keyPair(type);
      const jwt = await signAppJwt(credentials(pair.privateKey), Date.parse('2026-10-14T10:00:00Z'));
      expect(jwt.ok).toBe(true);
      if (!jwt.ok) return;
      const [header, payload] = jwt.value.split('.');
      expect(decodePart(header ?? '')).toEqual({ alg: 'RS256', typ: 'JWT' });
      expect(decodePart(payload ?? '')).toMatchObject({ iss: '12345' });
      const { iat, exp } = z.object({ iat: z.int(), exp: z.int() }).parse(decodePart(payload ?? ''));
      expect(exp - iat).toBeLessThanOrEqual(600);
      expect(await verifies(pair.publicKey, jwt.value)).toBe(true);
    },
  );

  it('refuses a key that is not one, saying only which step failed', async () => {
    const jwt = await signAppJwt(
      credentials('-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5\n-----END PRIVATE KEY-----'),
      0,
    );
    expect(jwt).toEqual({ ok: false, failure: { kind: 'shape', what: 'app private key' } });
  });

  it('exchanges the recorded token once and renews it five minutes before expiry', async () => {
    const pair = keyPair('pkcs1');
    let now = EXPIRES_AT - 60 * 60 * 1000;
    const seen: { url: string; authorization: string | null; body: unknown }[] = [];
    const tokens = createInstallationTokens({
      cache: createExpiringCache<string>(),
      now: () => now,
      fetch: async (input, init) => {
        seen.push({
          url: String(input),
          authorization: new Headers(init?.headers).get('authorization'),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(TOKEN_FIXTURE, { status: 201, headers: { 'content-type': 'application/json' } });
      },
    });
    const app = credentials(pair.privateKey);
    expect(await tokens.token(app)).toEqual({ ok: true, value: 'ghs_recorded_fixture_not_a_real_token' });
    now = EXPIRES_AT - 5 * 60 * 1000 - 1;
    await tokens.token(app);
    expect(seen).toHaveLength(1);
    now = EXPIRES_AT - 5 * 60 * 1000;
    await tokens.token(app);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.url).toBe('https://api.github.com/app/installations/99/access_tokens');
    expect(seen[0]?.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(seen[0]?.body).toEqual({
      permissions: { contents: 'write', pull_requests: 'write', issues: 'write', metadata: 'read' },
    });
  });

  it('reports a refused exchange as its status, with no key, JWT or body in it', async () => {
    const pair = keyPair('pkcs8');
    const tokens = createInstallationTokens({
      cache: createExpiringCache<string>(),
      now: () => 0,
      fetch: async () => new Response('{"message":"Bad credentials"}', { status: 401 }),
    });
    const result = await tokens.token(credentials(pair.privateKey));
    expect(result).toEqual({ ok: false, failure: { kind: 'status', status: 401 } });
    const unreachable = createInstallationTokens({
      cache: createExpiringCache<string>(),
      now: () => 0,
      fetch: async () => Promise.reject(new TypeError('fetch failed')),
    });
    expect(await unreachable.token(credentials(pair.privateKey))).toEqual({
      ok: false,
      failure: { kind: 'network' },
    });
  });
});
