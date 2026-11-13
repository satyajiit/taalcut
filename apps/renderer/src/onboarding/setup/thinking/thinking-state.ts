// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AccountsState, ModelSettings, PrivacyOverview, TaalcutError } from '@taalcut/core';
import { useBackend } from '../../../backend/backend';
import { useRpcStream } from '../../../backend/use-rpc';

/** What already works, per way (docs/onboarding.md section 4): a sign-in, a tested key, or Local only. */
export interface ThinkingWorks {
  readonly chatgpt: boolean;
  /** The warned plan signed in, if any. */
  readonly subscription: AccountsState['subscriptions'][number]['provider'] | null;
  /** The provider whose key passed its test, if any. */
  readonly apiKey: string | null;
  readonly localOnly: boolean;
  readonly any: boolean;
}

export function thinkingWorks(accounts: AccountsState, privacy: PrivacyOverview): ThinkingWorks {
  const chatgpt = accounts.chatgpt.signedIn;
  const subscription = accounts.subscriptions.find((each) => each.signedIn)?.provider ?? null;
  const apiKey = accounts.apiKeys.find((each) => each.configured && each.lastCheck?.ok)?.provider ?? null;
  const localOnly = privacy.localOnly;
  return {
    chatgpt,
    subscription,
    apiKey,
    localOnly,
    any: chatgpt || !!subscription || !!apiKey || localOnly,
  };
}

/** Accounts, privacy and the model settings, live: a sign-in finishing in the browser shows at once. */
export function useThinkingData(): {
  accounts?: AccountsState;
  privacy?: PrivacyOverview;
  models?: ModelSettings;
  /** The first read that failed, if one did. */
  error?: TaalcutError;
} {
  const backend = useBackend();
  const accounts = useRpcStream((signal) => backend.accounts.changed(undefined, { signal }), [backend]);
  const privacy = useRpcStream((signal) => backend.privacy.changed(undefined, { signal }), [backend]);
  const models = useRpcStream((signal) => backend.models.changed(undefined, { signal }), [backend]);
  return {
    ...(accounts.data ? { accounts: accounts.data } : {}),
    ...(privacy.data ? { privacy: privacy.data } : {}),
    ...(models.data ? { models: models.data } : {}),
    ...(accounts.error ? { error: accounts.error } : privacy.error ? { error: privacy.error } : {}),
  };
}
