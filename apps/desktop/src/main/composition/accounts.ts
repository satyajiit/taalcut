// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Accounts in main: models' accounts service over the AuthBroker
 * and the keychain vault, with the library's acknowledgements and the local
 * servers in the settings table. Keys come in once and never go back out.
 * Whenever a credential or a local server changes, the agent process is told
 * to drop its cached copy (`notify`).
 */
import {
  INSTAGRAM_PROVIDER,
  LOCAL_SERVER_KINDS,
  ok,
  type AccountsState,
  type AcknowledgementStore,
  type AsyncResult,
  type CloudCallSink,
  type SettingsStore,
  type SignInEvent,
} from '@taalcut/core';
import {
  createAccountsService,
  type AccountsService,
  type AcknowledgementStore as ModelsAcknowledgements,
  type AuthBroker,
  type ModelRuntime,
} from '@taalcut/models';
import { settingsLocalServerStore } from '../../shared/account-settings';
import type { MainInstagramAuth } from '../instagram/instagram-login';

/** models' acknowledgement gate over the library's AcknowledgementStore. */
export function modelsAcknowledgements(store: AcknowledgementStore): ModelsAcknowledgements {
  return {
    has: (feature, termsVersion) => store.has(feature, termsVersion),
    async record(feature, termsVersion, at) {
      const recorded = await store.record({ featureId: feature, termsVersion, at });
      return recorded.ok ? ok(undefined) : recorded;
    },
    async acknowledgedAt(feature, termsVersion) {
      const latest = await store.latest(feature);
      if (!latest.ok) return latest;
      return ok(latest.value?.termsVersion === termsVersion ? latest.value.acknowledgedAt : undefined);
    },
  };
}

export interface MainAccountsDeps {
  readonly broker: AuthBroker;
  /** The runtime the broker was made with. */
  readonly runtime: ModelRuntime;
  readonly settings: SettingsStore;
  readonly acknowledgements: AcknowledgementStore;
  /** Where key tests are logged. */
  readonly callLog: CloudCallSink;
  /** A credential or local server changed: the agent forgets its cached copy. */
  readonly notify: (provider: string) => void;
  /** Optional Instagram browser login and keychain session. */
  readonly instagram?: MainInstagramAuth;
}

export interface MainAccounts {
  readonly service: AccountsService;
  /** Sign-in progress (device codes for Copilot and Grok); wire `emit` as AuthBrokerDeps.onSignInEvent. */
  readonly signInEvents: {
    emit(event: SignInEvent): void;
    subscribe(listener: (event: SignInEvent) => void): () => void;
  };
  /** Triggers `changed()` subscribers when an external account (e.g. Instagram) changes. */
  notifyChanged(): void;
  dispose(): void;
}

export function createMainAccounts(deps: MainAccountsDeps): MainAccounts {
  const base = createAccountsService({
    broker: deps.broker,
    runtime: deps.runtime,
    acknowledgements: modelsAcknowledgements(deps.acknowledgements),
    callLog: deps.callLog,
    localServers: {
      // The agent re-reads the list when told about either kind.
      store: settingsLocalServerStore(deps.settings, () => {
        for (const kind of LOCAL_SERVER_KINDS) deps.notify(kind);
      }),
      runtimes: [deps.runtime],
    },
  });

  const extraChangeListeners = new Set<() => void>();
  const notifyChanged = () => {
    for (const listener of [...extraChangeListeners]) listener();
  };

  async function enrich(result: AsyncResult<AccountsState>): AsyncResult<AccountsState> {
    const resolved = await result;
    if (!resolved.ok || !deps.instagram) return resolved;
    const ig = await deps.instagram.status();
    if (!ig.ok) return resolved;
    return ok({
      ...resolved.value,
      instagram: ig.value,
    });
  }

  const service: AccountsService = {
    ...base,
    state: () => enrich(base.state()),
    async *changed(signal?: AbortSignal): AsyncGenerator<AccountsState, void, undefined> {
      const iter = base.changed(signal);
      let wakeExtra: (() => void) | undefined;
      const offExtra = () => wakeExtra?.();
      extraChangeListeners.add(offExtra);
      try {
        let nextBase = iter.next();
        while (!signal?.aborted) {
          const extraPromise = new Promise<'extra'>((resolve) => {
            wakeExtra = () => resolve('extra');
          });
          const raced = await Promise.race([
            nextBase.then((res) => ({ kind: 'base' as const, res })),
            extraPromise.then(() => ({ kind: 'extra' as const })),
          ]);
          wakeExtra = undefined;
          if (raced.kind === 'base') {
            if (raced.res.done) break;
            const enriched = await enrich(Promise.resolve(ok(raced.res.value)));
            if (enriched.ok) yield enriched.value;
            nextBase = iter.next();
          } else {
            const current = await enrich(base.state());
            if (current.ok) yield current.value;
          }
        }
      } finally {
        extraChangeListeners.delete(offExtra);
        void iter.return(undefined);
      }
    },
    async signIn(input) {
      if (input.provider === INSTAGRAM_PROVIDER && deps.instagram) {
        const signedIn = await deps.instagram.signIn({
          ...(input.acknowledgedAt !== undefined ? { acknowledgedAt: input.acknowledgedAt } : {}),
        });
        if (!signedIn.ok) return signedIn;
        deps.notify(INSTAGRAM_PROVIDER);
        notifyChanged();
        return enrich(base.state());
      }
      return enrich(base.signIn(input));
    },
    async signOut(input) {
      if (input.provider === INSTAGRAM_PROVIDER && deps.instagram) {
        const signedOut = await deps.instagram.signOut();
        if (!signedOut.ok) return signedOut;
        deps.notify(INSTAGRAM_PROVIDER);
        notifyChanged();
        return enrich(base.state());
      }
      return enrich(base.signOut(input));
    },
  };

  const unsubscribe = deps.broker.onChange((provider) => deps.notify(provider));
  const listeners = new Set<(event: SignInEvent) => void>();
  return {
    service,
    signInEvents: {
      emit(event) {
        for (const listener of [...listeners]) listener(event);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    notifyChanged,
    dispose() {
      unsubscribe();
      base.dispose();
    },
  };
}
