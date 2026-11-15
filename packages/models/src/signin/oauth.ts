// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * OAuth plumbing shared by Taalcut's own sign-in flows: PKCE, random values,
 * token-endpoint requests and a typed flow error. Messages never carry a token
 * or a response body: token endpoints echo grants and codes in their errors.
 */
import { createHash, randomBytes } from 'node:crypto';
import { jsonFromText } from '@taalcut/core';
import { z } from 'zod';
import type { FetchFn } from '../client/http-meter';
import { scrubSecrets } from '../scrub';

export type SignInFailureReason =
  | 'denied'
  | 'timeout'
  | 'cancelled'
  | 'port_busy'
  /** The token endpoint refused the code or the refresh token (invalid_grant and friends). */
  | 'rejected'
  | 'invalid_response'
  | 'network';

/** Thrown inside pi-ai's login/refresh hooks; the auth broker turns it into a TaalcutError. */
export class SignInFlowError extends Error {
  constructor(
    readonly reason: SignInFailureReason,
    message: string,
    readonly extra: {
      readonly status?: number;
      readonly port?: number;
      readonly seconds?: number;
      /** The OAuth error code of a token endpoint's refusal, e.g. invalid_grant. */
      readonly oauthError?: string;
    } = {},
  ) {
    super(message);
    this.name = 'SignInFlowError';
  }
}

/** The first SignInFlowError in a cause chain (pi-ai wraps hook errors in its own). */
export function findFlowError(cause: unknown): SignInFlowError | undefined {
  for (let current = cause, depth = 0; current && depth < 8; depth += 1) {
    if (current instanceof SignInFlowError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** RFC 7636 S256 pair. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  expires_in: z.number().positive(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

const OAuthErrorSchema = z.object({
  error: z.string().max(80),
  error_description: z.string().max(2000).optional(),
});

/**
 * The provider's own sentence about a refusal, made safe to keep: no value we sent (the code, the verifier, the
 * refresh token), nothing token-like, one short line. Without it "invalid_grant" does not say which grant, or why.
 */
function refusalNote(description: string | undefined, sent: readonly string[]): string {
  if (!description) return '';
  return scrubSecrets(description, sent)
    .replace(/[\w-]{24,}/g, '[withheld]')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 200);
}

/** POSTs a form to a token endpoint and validates the answer. */
export async function requestToken(
  fetch: FetchFn,
  url: string,
  form: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    if (signal?.aborted) throw new SignInFlowError('cancelled', 'Token request cancelled.');
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new SignInFlowError(
      'network',
      `Token request failed: ${scrubSecrets(message, Object.values(form))}`,
    );
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    // Keep the OAuth error code and the provider's sentence about it, scrubbed: the rest of the body may echo the
    // grant.
    const refusal = OAuthErrorSchema.safeParse(jsonFromText(text)).data;
    const code = refusal?.error;
    const note = refusalNote(refusal?.error_description, Object.values(form));
    const reason = response.status >= 500 || response.status === 429 ? 'network' : 'rejected';
    throw new SignInFlowError(
      reason,
      `Token endpoint answered ${response.status}${code ? ` (${code})` : ''}${note ? `: ${note}` : ''}.`,
      { status: response.status, ...(code ? { oauthError: code } : {}) },
    );
  }
  const parsed = TokenResponseSchema.safeParse(jsonFromText(text));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new SignInFlowError('invalid_response', `Token response is missing or has bad fields: ${fields}.`);
  }
  return parsed.data;
}

/**
 * The email claim of an OpenID id token, shown as the account label. Display
 * only: the token isn't verified and is never stored.
 */
export function emailFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown };
    return typeof claims.email === 'string' && claims.email.length <= 254 ? claims.email : undefined;
  } catch {
    return undefined;
  }
}
