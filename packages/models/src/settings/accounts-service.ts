// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The service behind Settings → Accounts (appContract.accounts), in main over
 * the AuthBroker. Not bus commands: a command's payload is logged, and an API
 * key must never reach a log or the database. A key comes in through
 * setApiKey once and is never returned: the state says only `configured`.
 */
import {
  CHATGPT_PROVIDER,
  CHATGPT_IMAGE_PROVIDER,
  err,
  isExternalLink,
  ok,
  WARNED_LOGINS,
  type AccountCheck,
  type AccountsState,
  type AsyncResult,
  type CloudCallSink,
  type LocalServerCheck,
  type LocalServerKind,
  type Result,
  type StockProviderId,
  STOCK_KEY_PROVIDERS,
} from '@taalcut/core';
import type { FetchFn } from '../client/http-meter';
import { createKeyTester, type ApiKeyTester } from '../credentials/api-keys';
import type { AccountStatus, AuthBroker } from '../credentials/auth-broker';
import { ELEVENLABS_PROVIDER } from '../elevenlabs/config';
import { ModelNotConfigured, SignInUnsupported } from '../errors';
import { BUILTIN_PROFILES } from '../registry/builtin-profiles';
import { runtimeInternals, type ModelRuntime } from '../runtime/runtime';
import { signInOption, type AcknowledgementStore } from '../signin/options';
import { createLocalServers, type LocalServersDeps } from './local-servers';
import { watched } from './watch';

export interface AccountsServiceDeps {
  readonly broker: AuthBroker;
  /** The runtime the broker was made with (`secrets` set): it knows which providers take a key. */
  readonly runtime: ModelRuntime;
  /** Records the warning-card acknowledgement sent with a sign-in, and reports when it was given. */
  readonly acknowledgements?: AcknowledgementStore;
  /** Tests a stored key. Default: one tiny request through ModelClient, logged to `callLog`. */
  readonly testApiKey?: ApiKeyTester;
  readonly callLog?: CloudCallSink;
  readonly fetch?: FetchFn;
  /** Providers that always get an API-key row. Default: the cloud providers the built-in profiles use. */
  readonly apiKeyProviders?: readonly string[];
  /** Bring-your-own servers (Advanced). */
  readonly localServers?: Pick<LocalServersDeps, 'store' | 'runtimes' | 'discover'>;
  readonly now?: () => number;
  /**
   * P3-V18: the stock media providers this build can use, each with its own key check (the stock lane's
   * client). The broker must keep their keys (`keyOnlyProviders`). The others are listed, not settable.
   */
  readonly stockKeys?: readonly { readonly provider: StockProviderId; readonly test: ApiKeyTester }[];
}

export interface AccountsService {
  state(): AsyncResult<AccountsState>;
  /** The current state first, then every change (a sign-in finishing in the browser, another window). */
  changed(signal?: AbortSignal): AsyncGenerator<AccountsState, void, undefined>;
  /** 'openai-codex' (the contract's id) and 'openai' both mean Continue with ChatGPT. */
  signIn(input: { readonly provider: string; readonly acknowledgedAt?: number }): AsyncResult<AccountsState>;
  signOut(input: { readonly provider: string }): AsyncResult<AccountsState>;
  /** Write-only: stores the key; the reply never contains it. Untested until testApiKey. */
  setApiKey(input: { readonly provider: string; readonly key: string }): AsyncResult<AccountsState>;
  testApiKey(input: { readonly provider: string }): AsyncResult<AccountCheck>;
  removeApiKey(input: { readonly provider: string }): AsyncResult<AccountsState>;
  setLocalServer(input: {
    readonly kind: LocalServerKind;
    readonly baseUrl: string | null;
  }): AsyncResult<AccountsState>;
  testLocalServer(input: { readonly kind: LocalServerKind }): AsyncResult<LocalServerCheck>;
  /** Registers the saved local servers. Call once at start-up. */
  load(): AsyncResult<void>;
  dispose(): void;
}

const CHATGPT = 'openai';
const signInTarget = (provider: string) => (provider === CHATGPT_PROVIDER ? CHATGPT : provider);

/** Round P3-3: the plan's usage page, when it is one a window may open (core's external-link hosts). */
function usagePage(provider: string): { usageUrl?: string } {
  const url = signInOption(provider)?.manageUsageUrl;
  return url && isExternalLink(url) ? { usageUrl: url } : {};
}

function defaultKeyProviders(runtime: ModelRuntime): string[] {
  const { models } = runtimeInternals(runtime);
  const used = new Set(
    BUILTIN_PROFILES.flatMap((p) => Object.values(p.modules).flatMap((m) => m.chain.map((c) => c.provider))),
  );
  return [...used].filter(
    (id) =>
      !runtime.isLocalProvider(id) &&
      (models.getProvider(id)?.auth.apiKey ||
        (id === ELEVENLABS_PROVIDER && models.getProvider('google') !== undefined)),
  );
}

export function createAccountsService(deps: AccountsServiceDeps): AccountsService {
  const { broker } = deps;
  const now = deps.now ?? Date.now;
  const keyProviders = deps.apiKeyProviders ?? defaultKeyProviders(deps.runtime);
  const keyChecks = new Map<string, AccountCheck>();
  const stockTesters = new Map<string, ApiKeyTester>((deps.stockKeys ?? []).map((s) => [s.provider, s.test]));
  const tester =
    deps.testApiKey ??
    createKeyTester({
      runtime: deps.runtime,
      callLog: deps.callLog ?? { record: async () => ok(undefined) },
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
  const servers = createLocalServers({
    ...deps.localServers,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    now,
  });

  async function acknowledgedAt(feature: string, termsVersion: string): Promise<number | undefined> {
    const at = await deps.acknowledgements?.acknowledgedAt?.(feature, termsVersion);
    return at?.ok ? at.value : undefined;
  }

  async function state(): AsyncResult<AccountsState> {
    const statuses = await broker.statuses();
    if (!statuses.ok) return statuses;
    const byProvider = new Map<string, AccountStatus>(statuses.value.map((s) => [s.provider, s]));
    const method = (provider: string) => byProvider.get(provider)?.method;
    const isStock = (provider: string) => (STOCK_KEY_PROVIDERS as readonly string[]).includes(provider);
    const stored = statuses.value
      .filter((s) => s.method === 'api_key' && !isStock(s.provider))
      .map((s) => s.provider);
    const subscriptions = [];
    for (const provider of WARNED_LOGINS) {
      const warning = signInOption(provider)?.warning;
      if (!warning) continue;
      const at = await acknowledgedAt(warning.feature, warning.termsVersion);
      subscriptions.push({
        provider,
        signedIn: method(provider) === 'subscription',
        warning: {
          feature: warning.feature,
          termsVersion: warning.termsVersion,
          titleKey: warning.titleKey,
          bodyKey: warning.bodyKey,
          riskKey: warning.riskKey,
        },
        ...(at !== undefined ? { acknowledgedAt: at } : {}),
        ...usagePage(provider),
      });
    }
    return ok({
      chatgpt: {
        signedIn: method(CHATGPT) === 'subscription',
        imagesSignedIn: method(CHATGPT_IMAGE_PROVIDER) === 'subscription',
        manageUsageUrl: signInOption(CHATGPT)?.manageUsageUrl ?? 'https://chatgpt.com/settings/usage',
      },
      subscriptions,
      apiKeys: [...new Set([...keyProviders, ...stored])].map((provider) => {
        const lastCheck = keyChecks.get(provider);
        return { provider, configured: method(provider) === 'api_key', ...(lastCheck ? { lastCheck } : {}) };
      }),
      localServers: servers.rows(),
      // Apart from model keys, so no model picker lists them; configured is what the keychain holds.
      stockKeys: stockKeyRows(method, keyChecks, stockTesters),
    });
  }

  const watch = watched(async () => {
    const current = await state();
    // A stream error leaves as a TaalcutError (core's IPC maps thrown errors).
    if (!current.ok) throw current.error;
    return current.value;
  });
  const unsubscribe = broker.onChange(() => watch.notify());

  /** Applies a change, then answers with the new state. */
  const after = async (change: AsyncResult<unknown>): AsyncResult<AccountsState> => {
    const applied = await change;
    if (!applied.ok) return applied;
    watch.notify();
    return state();
  };
  const methodOf = async (provider: string): Promise<Result<AccountStatus['method']>> => {
    const status = await broker.status(provider);
    return status.ok ? ok(status.value.method) : status;
  };

  return {
    state,
    changed: (signal) => watch.stream(signal),
    async signIn({ provider, acknowledgedAt: at }) {
      const target = signInTarget(provider);
      const option = signInOption(target);
      if (!option) return err(SignInUnsupported({ provider }));
      if (option.warning && at !== undefined && deps.acknowledgements) {
        const recorded = await deps.acknowledgements.record(
          option.warning.feature,
          option.warning.termsVersion,
          at,
        );
        if (!recorded.ok) return recorded;
      }
      // The broker refuses a warned sign-in whose card wasn't acknowledged (P1-F6).
      return after(broker.signIn(target));
    },
    async signOut({ provider }) {
      const target = signInTarget(provider);
      const method = await methodOf(target);
      if (!method.ok) return method;
      // An API key is removed with removeApiKey, never by signing out of a plan.
      if (method.value !== 'subscription') return state();
      return after(broker.signOut(target));
    },
    async setApiKey({ provider, key }) {
      keyChecks.delete(provider);
      return after(broker.setApiKey(provider, key, { skipTest: true }));
    },
    async testApiKey({ provider }) {
      const credential = await broker.get(provider);
      if (!credential.ok) return credential;
      if (credential.value?.kind !== 'api_key' || !credential.value.secret)
        return err(ModelNotConfigured({ provider }));
      const tested = await (stockTesters.get(provider) ?? tester)(provider, credential.value.secret);
      const check: AccountCheck = tested.ok
        ? { at: now(), ok: true }
        : { at: now(), ok: false, errorCode: tested.error.code };
      keyChecks.set(provider, check);
      watch.notify();
      return ok(check);
    },
    async removeApiKey({ provider }) {
      const method = await methodOf(provider);
      if (!method.ok) return method;
      keyChecks.delete(provider);
      // A plan sign-in on the same provider (ChatGPT on openai) stays.
      if (method.value !== 'api_key') return state();
      return after(broker.signOut(provider));
    },
    setLocalServer: ({ kind, baseUrl }) => after(servers.set(kind, baseUrl)),
    async testLocalServer({ kind }) {
      const check = await servers.test(kind);
      watch.notify();
      return check;
    },
    load: () => servers.load(),
    dispose: unsubscribe,
  };
}

/** P3-V18: every stock provider; `available` only for those this build can test (it has their client). */
function stockKeyRows(
  method: (provider: string) => string | undefined,
  keyChecks: ReadonlyMap<string, AccountCheck>,
  testers: ReadonlyMap<string, ApiKeyTester>,
) {
  return STOCK_KEY_PROVIDERS.map((provider) => {
    const lastCheck = keyChecks.get(provider);
    return {
      provider,
      configured: method(provider) === 'api_key',
      available: testers.has(provider),
      ...(lastCheck ? { lastCheck } : {}),
    };
  });
}
