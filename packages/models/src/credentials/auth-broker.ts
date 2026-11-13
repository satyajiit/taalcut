// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main-process side of accounts (PRD 8.4; P1-F3, F4, F6). The broker owns a
 * runtime whose pi-ai credential store is the SecretStore, so sign-in, pi-ai's
 * locked OAuth refresh and API keys all live here. It hands other processes
 * only what one request needs: an API key or a short-lived access token, never
 * a refresh token. The renderer gets AccountStatus, which holds no secret.
 */
import { randomUUID } from 'node:crypto';
import type { Credential } from '@earendil-works/pi-ai';
import { err, ok, type AsyncResult, type CloudCallSink } from '@taalcut/core';
import type { FetchFn } from '../client/http-meter';
import { ApiKeyInvalid } from '../errors';
import { runtimeInternals, type ModelRuntime } from '../runtime/runtime';
import { scrubSecrets } from '../scrub';
import { signInOption, SIGN_IN_OPTIONS, type AcknowledgementStore } from '../signin/options';
import { runSignIn, type SignInEvent, type SignInRequest } from '../signin/sign-in';
import { createKeyTester, type ApiKeyTester } from './api-keys';
import type { CredentialProvider, ResolvedCredential } from './credential-provider';
import { ELEVENLABS_PROVIDER } from '../elevenlabs/config';
import { authFailure } from './failures';
import { DEVICE_ID_KEY } from './secret-store';

/** What the renderer may know about an account. Never a key or token. */
export interface AccountStatus {
  readonly provider: string;
  readonly signedIn: boolean;
  readonly method?: 'subscription' | 'api_key';
  /** "Using ChatGPT plan", "Using API key", "Not connected". */
  readonly planLabelKey: string;
  /** The account's email, when the sign-in says. */
  readonly accountLabel?: string;
  /** When the current access token expires (epoch ms); it renews by itself. */
  readonly expiresAt?: number;
  /** "Manage usage" link, only where the provider publishes one. */
  readonly manageUsageUrl?: string;
}

export interface AuthBroker extends CredentialProvider {
  status(provider: string): AsyncResult<AccountStatus>;
  /** Every sign-in option plus every provider with a stored key. */
  statuses(): AsyncResult<readonly AccountStatus[]>;
  /** Runs the provider's browser or device-code sign-in. A newer call for the same provider cancels this one. */
  signIn(provider: string, request?: SignInRequest): AsyncResult<AccountStatus>;
  cancelSignIn(provider: string): void;
  /** Records that the user accepted a warning card (P1-F6). */
  acknowledge(feature: string, termsVersion: string): AsyncResult<void>;
  /** Tests the key with one tiny request, then stores it. Replaces any sign-in for that provider. */
  setApiKey(
    provider: string,
    key: string,
    options?: { readonly skipTest?: boolean; readonly signal?: AbortSignal },
  ): AsyncResult<AccountStatus>;
  signOut(provider: string): AsyncResult<void>;
  /** Fires after a sign-in, sign-out or key change: refresh the UI, and `forget` the agent's cached copy. */
  onChange(listener: (provider: string) => void): () => void;
  /** Removes every key and token this broker has handled from text bound for a log. */
  scrub(text: string): string;
}

export interface AuthBrokerDeps {
  /** A runtime created with `secrets` set. */
  readonly runtime: ModelRuntime;
  /** Electron's shell.openExternal. */
  readonly openExternal: (url: string) => void | Promise<void>;
  /** Needed for the warning-gated sign-ins (Claude, Copilot, Grok); without it they are refused. */
  readonly acknowledgements?: AcknowledgementStore;
  readonly onSignInEvent?: (event: SignInEvent) => void;
  /** Where key-test calls are logged. */
  readonly callLog?: CloudCallSink;
  /** HTTP for key-test calls (record/replay plugs in here). */
  readonly fetch?: FetchFn;
  /** Default: one tiny request to the provider's cheapest chat model. */
  readonly testApiKey?: ApiKeyTester;
  /** Default 5 minutes. */
  readonly signInTimeoutMs?: number;
  readonly now?: () => number;
  /**
   * Providers outside the model catalogue that keep only an API key (P3-V18's stock media). Their keys are
   * stored and read like model keys; their owner tests them (Accounts), never a model call here.
   */
  readonly keyOnlyProviders?: readonly string[];
}

const REFRESH_TIMEOUT_MS = 15_000;
const MAX_REMEMBERED_SECRETS = 64;

export function createAuthBroker(deps: AuthBrokerDeps): AuthBroker {
  const { models, credentials, secrets } = runtimeInternals(deps.runtime);
  const now = deps.now ?? Date.now;
  const keyOnly = new Set([ELEVENLABS_PROVIDER, ...(deps.keyOnlyProviders ?? [])]);
  const listeners = new Set<(provider: string) => void>();
  const pending = new Map<string, { controller: AbortController; done: Promise<unknown> }>();
  /** The access token last handed out per provider, so a forced refresh runs once per rejected token. */
  const issued = new Map<string, string>();
  const rejected = new Set<string>();
  const seen = new Set<string>();
  let localDeviceId: string | undefined;

  const remember = (...values: (string | undefined)[]) => {
    for (const value of values) {
      if (!value || seen.has(value)) continue;
      seen.add(value);
      if (seen.size > MAX_REMEMBERED_SECRETS) seen.delete(seen.values().next().value as string);
    }
  };
  const known = () => [...seen];
  const changed = (provider: string) => {
    for (const listener of listeners) listener(provider);
  };
  const testApiKey =
    deps.testApiKey ??
    createKeyTester({
      runtime: deps.runtime,
      callLog: deps.callLog ?? { record: async () => ok(undefined) },
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });

  async function read(provider: string): Promise<Credential | undefined> {
    const stored = await credentials.read(provider);
    if (stored?.type === 'oauth') remember(stored.access, stored.refresh);
    if (stored?.type === 'api_key') remember(stored.key);
    return stored;
  }

  async function forceRefresh(provider: string): Promise<void> {
    const oauth = models.getProvider(provider)?.auth.oauth;
    if (!oauth) return;
    const rejectedToken = issued.get(provider);
    await credentials.modify(provider, async (current) => {
      if (current?.type !== 'oauth') return undefined;
      // Another request already refreshed after the 401.
      if (rejectedToken !== undefined && current.access !== rejectedToken) return undefined;
      remember(current.access, current.refresh);
      const next = await oauth.refresh(current, AbortSignal.timeout(REFRESH_TIMEOUT_MS));
      remember(next.access, next.refresh);
      return next;
    });
  }

  async function deviceId(): AsyncResult<string> {
    if (!secrets) return ok((localDeviceId ??= randomUUID()));
    const stored = await secrets.get(DEVICE_ID_KEY);
    if (!stored.ok) return stored;
    if (stored.value) return ok(stored.value);
    const created = randomUUID();
    const saved = await secrets.set(DEVICE_ID_KEY, created);
    return saved.ok ? ok(created) : saved;
  }

  /** A key-only provider's stored key, read straight from the store (no model provider resolves it). */
  async function keyOnlyCredential(provider: string): AsyncResult<ResolvedCredential | undefined> {
    try {
      const stored = await read(provider);
      return ok(
        stored?.type === 'api_key'
          ? { kind: 'api_key', secret: stored.key, source: 'stored credential' }
          : undefined,
      );
    } catch (cause) {
      return err(authFailure(provider, cause, 'credential', known()));
    }
  }

  async function status(provider: string): AsyncResult<AccountStatus> {
    const option = signInOption(provider);
    let stored: Credential | undefined;
    try {
      stored = await read(provider);
    } catch (cause) {
      return err(authFailure(provider, cause, 'credential', known()));
    }
    if (stored?.type === 'oauth') {
      const label = (stored as { accountLabel?: unknown }).accountLabel;
      return ok({
        provider,
        signedIn: true,
        method: 'subscription',
        planLabelKey: option?.planLabelKey ?? 'models.account.signedIn',
        ...(typeof label === 'string' ? { accountLabel: label } : {}),
        expiresAt: stored.expires,
        ...(option?.manageUsageUrl ? { manageUsageUrl: option.manageUsageUrl } : {}),
      });
    }
    if (stored?.type === 'api_key')
      return ok({ provider, signedIn: true, method: 'api_key', planLabelKey: 'models.account.usingApiKey' });
    return ok({ provider, signedIn: false, planLabelKey: 'models.account.notConnected' });
  }

  return {
    async get(provider, request = {}): AsyncResult<ResolvedCredential | undefined> {
      if (keyOnly.has(provider)) return keyOnlyCredential(provider);
      try {
        if (request.forceRefresh || rejected.delete(provider)) await forceRefresh(provider);
        const resolved = await models.getAuth(provider, {
          ...(request.signal ? { signal: request.signal } : {}),
          ...(request.minValidityMs !== undefined ? { minOAuthValidityMs: request.minValidityMs } : {}),
        });
        if (!resolved) return ok(undefined);
        const stored = await read(provider);
        const { apiKey, headers, baseUrl } = resolved.auth;
        remember(apiKey);
        if (apiKey) issued.set(provider, apiKey);
        return ok({
          kind: stored?.type === 'oauth' ? 'oauth_access' : apiKey ? 'api_key' : 'none',
          ...(apiKey ? { secret: apiKey } : {}),
          ...(headers ? { headers: definedHeaders(headers) } : {}),
          ...(baseUrl ? { baseUrl } : {}),
          ...(resolved.env ? { env: resolved.env } : {}),
          ...(stored?.type === 'oauth' ? { expiresAt: stored.expires } : {}),
          source: resolved.source ?? 'unknown',
        });
      } catch (cause) {
        return err(authFailure(provider, cause, 'credential', known()));
      }
    },
    invalidate(provider) {
      rejected.add(provider);
    },
    status,
    async statuses() {
      const ids = new Set(SIGN_IN_OPTIONS.map((o) => o.provider));
      try {
        for (const info of await credentials.list()) ids.add(info.providerId);
      } catch (cause) {
        return err(authFailure('*', cause, 'credential', known()));
      }
      const out: AccountStatus[] = [];
      for (const id of ids) {
        const one = await status(id);
        if (!one.ok) return one;
        out.push(one.value);
      }
      return ok(out);
    },
    async signIn(provider, request = {}) {
      const previous = pending.get(provider);
      if (previous) {
        previous.controller.abort();
        await previous.done;
      }
      const controller = new AbortController();
      const forward = () => controller.abort();
      request.signal?.addEventListener('abort', forward, { once: true });
      if (request.signal?.aborted) controller.abort();
      const run = runSignIn(
        {
          models,
          openExternal: deps.openExternal,
          ...(deps.acknowledgements ? { acknowledgements: deps.acknowledgements } : {}),
          ...(deps.onSignInEvent ? { onEvent: deps.onSignInEvent } : {}),
          deviceId,
          agentName: 'Taalcut',
          timeoutMs: deps.signInTimeoutMs ?? 5 * 60_000,
          secrets: known,
        },
        provider,
        { ...request, signal: controller.signal },
      );
      pending.set(provider, { controller, done: run });
      const outcome = await run;
      if (pending.get(provider)?.controller === controller) pending.delete(provider);
      request.signal?.removeEventListener('abort', forward);
      if (!outcome.ok) return outcome;
      issued.delete(provider);
      changed(provider);
      return status(provider);
    },
    cancelSignIn(provider) {
      pending.get(provider)?.controller.abort();
    },
    async acknowledge(feature, termsVersion) {
      if (!deps.acknowledgements) return ok(undefined);
      return deps.acknowledgements.record(feature, termsVersion, now());
    },
    async setApiKey(provider, rawKey, options = {}) {
      const key = rawKey.trim();
      // Even a refused key is a secret someone may paste into a log line.
      remember(key);
      const takesKey = keyOnly.has(provider) || models.getProvider(provider)?.auth.apiKey;
      if (!key || !takesKey)
        return err(
          ApiKeyInvalid({ provider }, { detail: key ? 'Provider takes no API key.' : 'Empty key.' }),
        );
      if (!options.skipTest && !keyOnly.has(provider)) {
        const tested = await testApiKey(provider, key, options.signal);
        if (!tested.ok) return err({ ...tested.error, ...scrubbedDetail(tested.error.detail, known()) });
      }
      try {
        await credentials.modify(provider, async () => ({ type: 'api_key', key }));
      } catch (cause) {
        return err(authFailure(provider, cause, 'credential', known()));
      }
      issued.delete(provider);
      changed(provider);
      return status(provider);
    },
    async signOut(provider) {
      try {
        await models.logout(provider);
      } catch (cause) {
        return err(authFailure(provider, cause, 'credential', known()));
      }
      issued.delete(provider);
      changed(provider);
      return ok(undefined);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    scrub: (text) => scrubSecrets(text, known()),
  };
}

function scrubbedDetail(detail: string | undefined, secrets: readonly string[]): { detail?: string } {
  return detail ? { detail: scrubSecrets(detail, secrets) } : {};
}

function definedHeaders(headers: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) if (value !== null) out[name] = value;
  return out;
}
