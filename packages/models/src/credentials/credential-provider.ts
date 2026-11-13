// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where ModelClient gets the secret for each request. It runs in the agent
 * utility process, so it only ever sees API keys and short-lived OAuth access
 * tokens. Refresh tokens stay in the main process (PRD 8.4); see auth-broker.ts
 * and SPEC.md, "Auth token flow".
 */
import { ok, type AsyncResult } from '@taalcut/core';

export interface ResolvedCredential {
  readonly kind: 'api_key' | 'oauth_access' | 'none';
  /** The API key or access token sent to the provider. Absent for keyless local servers. */
  readonly secret?: string;
  /** Extra headers the credential implies (e.g. an account id). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Per-account endpoint, when the sign-in decides it (GitHub Copilot). */
  readonly baseUrl?: string;
  /** Provider-scoped settings such as a Cloudflare account id. Not secret. */
  readonly env?: Readonly<Record<string, string>>;
  /** Epoch ms after which an access token stops working. */
  readonly expiresAt?: number;
  /** Non-secret label for status UI, e.g. 'stored credential' or 'OAuth'. */
  readonly source: string;
}

export interface CredentialRequest {
  readonly signal?: AbortSignal;
  /** The token must stay valid at least this long. Default 60 s. */
  readonly minValidityMs?: number;
  /** The provider rejected the last token (HTTP 401): refresh it even if its clock says it's fine. */
  readonly forceRefresh?: boolean;
}

export interface CredentialProvider {
  /** The credential for the next request, or undefined when the provider isn't set up. */
  get(providerId: string, request?: CredentialRequest): AsyncResult<ResolvedCredential | undefined>;
  /** The provider rejected this credential (HTTP 401), so drop any cached copy and refresh next time. */
  invalidate?(providerId: string): void;
}

/** Fixed credentials. For tests, keyless local servers and keys read once at start-up. */
export function createStaticCredentialProvider(
  credentials: Readonly<Record<string, ResolvedCredential>>,
): CredentialProvider {
  return {
    get: async (providerId) => ok(credentials[providerId]),
  };
}

export interface CachingCredentialProviderDeps {
  /** Fetches a fresh credential, usually over IPC from the main process. */
  readonly source: CredentialProvider;
  readonly now?: () => number;
}

export interface CachingCredentialProvider extends CredentialProvider {
  invalidate(providerId: string): void;
  /** The stored credential changed in the main process (new key, sign-in, sign-out): drop the copy. */
  forget(providerId: string): void;
  /**
   * What kind of credential the last call to `providerId` got (a key, or a plan's sign-in), until it is forgotten;
   * undefined before the first. A 401 keeps it: the same kind comes back refreshed.
   */
  kindOf(providerId: string): ResolvedCredential['kind'] | undefined;
}

const DEFAULT_MIN_VALIDITY_MS = 60_000;

/**
 * Caches credentials until they are about to expire, so the agent process
 * doesn't cross IPC for every call. A 401 drops the cached copy, and the next
 * request to the source carries `forceRefresh`, so it doesn't depend on a
 * separate invalidate message arriving first.
 */
export function createCachingCredentialProvider(
  deps: CachingCredentialProviderDeps,
): CachingCredentialProvider {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, ResolvedCredential>();
  const kinds = new Map<string, ResolvedCredential['kind']>();
  const rejected = new Set<string>();
  const isFresh = (credential: ResolvedCredential, minValidityMs: number): boolean =>
    credential.expiresAt === undefined || credential.expiresAt - now() > minValidityMs;

  return {
    async get(providerId, request = {}) {
      const minValidityMs = request.minValidityMs ?? DEFAULT_MIN_VALIDITY_MS;
      const cached = cache.get(providerId);
      if (cached && isFresh(cached, minValidityMs)) return ok(cached);
      const forceRefresh = request.forceRefresh === true || rejected.has(providerId);
      rejected.delete(providerId);
      const fresh = await deps.source.get(providerId, {
        ...request,
        minValidityMs,
        ...(forceRefresh ? { forceRefresh } : {}),
      });
      if (fresh.ok && fresh.value) {
        cache.set(providerId, fresh.value);
        kinds.set(providerId, fresh.value.kind);
      } else {
        cache.delete(providerId);
        if (fresh.ok) kinds.delete(providerId);
      }
      return fresh;
    },
    invalidate(providerId) {
      cache.delete(providerId);
      rejected.add(providerId);
    },
    forget(providerId) {
      cache.delete(providerId);
      kinds.delete(providerId);
    },
    kindOf: (providerId) => kinds.get(providerId),
  };
}
