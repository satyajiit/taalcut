// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turns whatever a sign-in, refresh or credential lookup threw into a
 * TaalcutError. pi-ai wraps hook errors in its own ModelsError, so we walk the
 * cause chain. The developer detail is scrubbed of every secret the broker has
 * seen: some providers' refresh errors include the response body.
 */
import { CancelledError, type TaalcutError } from '@taalcut/core';
import {
  ModelAuthExpired,
  ModelProviderError,
  SignInDenied,
  SignInFailed,
  SignInPortBusy,
  SignInRequired,
  SignInTimeout,
} from '../errors';
import { scrubSecrets } from '../scrub';
import { findFlowError } from '../signin/oauth';
import { SecretStoreError } from './secret-store';

/** What was running: an interactive sign-in, or fetching a credential for a request. */
export type AuthPhase = 'sign_in' | 'credential';

export function authFailure(
  provider: string,
  cause: unknown,
  phase: AuthPhase,
  secrets: readonly string[],
): TaalcutError {
  const store = findInChain(cause, (c): c is SecretStoreError => c instanceof SecretStoreError);
  if (store) return store.error;
  const detail = scrubSecrets(messages(cause), secrets).slice(0, 2000);
  const extras = { detail };
  const params = { provider };
  const flow = findFlowError(cause);
  const signingIn = phase === 'sign_in';

  switch (flow?.reason) {
    case 'cancelled':
      return CancelledError(undefined, extras);
    case 'denied':
      return SignInDenied(params, extras);
    case 'timeout':
      return SignInTimeout({ provider, seconds: flow.extra.seconds ?? 0 }, extras);
    case 'port_busy':
      return SignInPortBusy({ provider, port: flow.extra.port ?? 0 }, extras);
    case 'rejected':
      // A refused refresh token won't work on retry; only signing in again helps.
      return signingIn ? SignInFailed(params, extras) : SignInRequired(params, extras);
    case 'invalid_response':
    case 'network':
      return signingIn ? SignInFailed(params, extras) : ModelAuthExpired(params, extras);
    case undefined:
      break;
  }
  // pi-ai's own flows (Claude, Copilot, Grok) throw plain errors.
  if (isCancellation(cause)) return CancelledError(undefined, extras);
  if (signingIn) return SignInFailed(params, extras);
  if ((cause as { code?: unknown } | undefined)?.code === 'oauth') return ModelAuthExpired(params, extras);
  return ModelProviderError(params, extras);
}

function findInChain<T>(cause: unknown, match: (value: unknown) => value is T): T | undefined {
  for (let current = cause, depth = 0; current && depth < 8; depth += 1) {
    if (match(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** "outer: inner: innermost", without stacks. */
function messages(cause: unknown): string {
  const parts: string[] = [];
  for (let current = cause, depth = 0; current && depth < 5; depth += 1) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(': ');
}

function isCancellation(cause: unknown): boolean {
  return (
    findInChain(
      cause,
      (c): c is Error =>
        c instanceof Error && (c.name === 'AbortError' || /^login cancelled$/i.test(c.message)),
    ) !== undefined
  );
}
