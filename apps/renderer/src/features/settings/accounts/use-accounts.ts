// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings › Accounts' one state, shared by its four views (UX4): the accounts stream (the state now, then every
 * change: a sign-in finishing in the browser, another window), which provider has a call on its way, the last
 * failure in words, and the polite line a screen reader hears when one lands. These talk to main's accounts
 * service directly, not through the command bus, because command payloads are logged and a key must never be.
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  CHATGPT_IMAGE_PROVIDER,
  CHATGPT_PROVIDER,
  type AccountsState,
  type LocalServerKind,
  type WarnedLogin,
} from '@taalcut/core';
import { useHostPlatform } from '@taalcut/ui';
import { useReducer, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcStream, type Reloadable } from '../../../backend/use-rpc';
import { describeError } from '../model-messages';
import { providerName } from '../providers';
import type { ApiKeyActions } from './api-keys';
import type { LocalServerActions } from './local-servers';
import type { SignInActions } from './sign-ins';

export interface Accounts {
  readonly stream: Reloadable<AccountsState>;
  /** Try again: re-opens the stream (a new round). */
  readonly retry: () => void;
  readonly pending: string | null;
  /** The last call's failure, as a sentence. */
  readonly failure: string | null;
  /** What a screen reader hears when a call lands. */
  readonly announcement: string;
  /** The provider whose call last landed well, so its button can show the tick. */
  readonly done: string | null;
  readonly chatgpt: SignInActions;
  readonly plans: SignInActions;
  readonly keys: ApiKeyActions;
  readonly servers: LocalServerActions;
}

export function useAccounts(): Accounts {
  const { t, i18n } = useLingui();
  const platform = useHostPlatform();
  const backend = useBackend();
  const [round, retry] = useReducer((n: number) => n + 1, 0);
  const stream = useRpcStream((signal) => backend.accounts.changed(undefined, { signal }), [backend, round]);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [done, setDone] = useState<string | null>(null);

  /** Runs one call for a provider; returns a translated error sentence, or null. */
  async function act<T>(provider: string, call: () => Promise<T>, said?: string): Promise<string | null> {
    setPending(provider);
    setFailure(null);
    setDone(null);
    const result = await callRpc(call());
    setPending(null);
    if (result.ok) {
      if (said) setAnnouncement(said);
      setDone(provider);
      return null;
    }
    return describeError(i18n, result.error, platform);
  }
  const report = async (outcome: Promise<string | null>) => {
    const message = await outcome;
    if (message) setFailure(message);
  };
  const nameOf = (provider: string) => providerName(i18n, provider) ?? provider;
  const signOut = (provider: string) =>
    report(act(provider, () => backend.accounts.signOut({ provider }), t`Signed out.`));

  return {
    stream,
    retry,
    pending,
    failure,
    announcement,
    done,
    chatgpt: {
      pending,
      signIn: (provider) =>
        report(
          act(
            provider,
            () =>
              backend.accounts.signIn({
                provider: provider === CHATGPT_IMAGE_PROVIDER ? CHATGPT_IMAGE_PROVIDER : CHATGPT_PROVIDER,
              }),
            t`Signed in. Taalcut now uses your ChatGPT plan.`,
          ),
        ),
      signOut,
    },
    plans: {
      pending,
      signIn: (provider, acknowledgedAt) =>
        report(
          act(
            provider,
            () =>
              backend.accounts.signIn({
                provider: provider as WarnedLogin,
                ...(acknowledgedAt !== undefined ? { acknowledgedAt } : {}),
              }),
            t`Signed in.`,
          ),
        ),
      signOut,
    },
    keys: {
      pending,
      save: (provider, key) => {
        const name = nameOf(provider);
        return act(
          provider,
          () => backend.accounts.setApiKey({ provider, key }),
          t`${name} key saved. Test it to check it works.`,
        );
      },
      test: (provider) => report(act(provider, () => backend.accounts.testApiKey({ provider }))),
      remove: (provider) => {
        const name = nameOf(provider);
        return report(
          act(provider, () => backend.accounts.removeApiKey({ provider }), t`${name} key removed.`),
        );
      },
    },
    servers: {
      pending,
      save: (kind: LocalServerKind, baseUrl) => {
        const name = nameOf(kind);
        const said = baseUrl ? t`${name} address saved.` : t`Stopped using ${name}.`;
        return act(kind, () => backend.accounts.setLocalServer({ kind, baseUrl }), said);
      },
      test: (kind) => report(act(kind, () => backend.accounts.testLocalServer({ kind }))),
    },
  };
}
