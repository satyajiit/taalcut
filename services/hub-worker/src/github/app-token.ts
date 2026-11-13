// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The GitHub App's installation token (docs/template-hub.md section 4): an RS256 App JWT signed with WebCrypto,
 * exchanged for a one-hour token narrowed to the hub's permissions, kept until five minutes before it expires.
 * The private key, the JWT and the token never reach an error, a log or a response: a failure says only which
 * step failed.
 */
import { z } from 'zod';

import { type ExpiringCache } from '../cache/expiring-cache';
import { bytesToBase64Url, pemToDer } from '../encoding/bytes';
import { jsonValue } from '../encoding/json-text';
import { pkcs8FromPkcs1 } from './pkcs8';
import { type GitHubResult } from './github-port';
import { GITHUB_API_VERSION } from './rest-call';

export interface AppCredentials {
  appId: string;
  privateKeyPem: string;
  installationId: string;
}

export interface InstallationTokens {
  token(credentials: AppCredentials): Promise<GitHubResult<string>>;
}

const RENEW_BEFORE_MS = 5 * 60 * 1000;
/** WebCrypto's key type (the Worker's lib has no DOM `CryptoKey`). */
type SigningKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const tokenBody = z.object({ token: z.string().min(1), expires_at: z.iso.datetime() });

/** RS256 App JWT. `exp` is 9 minutes after `iat`, inside GitHub's 10 minute cap. */
export async function signAppJwt(credentials: AppCredentials, nowMs: number): Promise<GitHubResult<string>> {
  const iat = Math.floor(nowMs / 1000) - 30;
  const exp = iat + 9 * 60;
  const header = bytesToBase64Url(encodeJson({ alg: 'RS256', typ: 'JWT' }));
  const payload = bytesToBase64Url(encodeJson({ iss: credentials.appId, iat, exp }));
  const signingInput = `${header}.${payload}`;
  const key = await signingKey(credentials.privateKeyPem);
  if (!key) return { ok: false, failure: { kind: 'shape', what: 'app private key' } };
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return { ok: true, value: `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}` };
}

export function createInstallationTokens(deps: {
  fetch: typeof fetch;
  now: () => number;
  cache: ExpiringCache<string>;
}): InstallationTokens {
  return {
    async token(credentials) {
      const now = deps.now();
      const key = `${credentials.appId}:${credentials.installationId}`;
      const cached = deps.cache.get(key, now);
      if (cached !== undefined) return { ok: true, value: cached };
      const jwt = await signAppJwt(credentials, now);
      if (!jwt.ok) return jwt;
      let response: Response;
      try {
        response = await deps.fetch(
          `https://api.github.com/app/installations/${encodeURIComponent(credentials.installationId)}/access_tokens`,
          {
            method: 'POST',
            headers: {
              accept: 'application/vnd.github+json',
              authorization: `Bearer ${jwt.value}`,
              'content-type': 'application/json',
              'user-agent': 'taalcut-hub-worker',
              'x-github-api-version': GITHUB_API_VERSION,
            },
            body: JSON.stringify({
              permissions: { contents: 'write', pull_requests: 'write', issues: 'write', metadata: 'read' },
            }),
          },
        );
      } catch {
        // No response at all (DNS, TLS, reset). The request held the JWT, so nothing of it is kept.
        return { ok: false, failure: { kind: 'network' } };
      }
      if (!response.ok) return { ok: false, failure: { kind: 'status', status: response.status } };
      const body = tokenBody.safeParse(jsonValue(await response.text()));
      if (!body.success) return { ok: false, failure: { kind: 'shape', what: 'installation token' } };
      deps.cache.set(key, body.data.token, Date.parse(body.data.expires_at) - RENEW_BEFORE_MS);
      return { ok: true, value: body.data.token };
    },
  };
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

/** GitHub App keys are PKCS#1 (`BEGIN RSA PRIVATE KEY`); WebCrypto imports PKCS#8. Null for anything else. */
async function signingKey(pem: string): Promise<SigningKey | null> {
  const der = pemToDer(pem);
  if (!der) return null;
  const pkcs8 = /BEGIN PRIVATE KEY/.test(pem)
    ? der
    : /BEGIN RSA PRIVATE KEY/.test(pem)
      ? pkcs8FromPkcs1(der)
      : null;
  if (!pkcs8) return null;
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    // importKey rejects a malformed key; its message is dropped so no key bytes can reach a log.
    return null;
  }
}
