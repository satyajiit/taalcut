// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's half of the hub's install key (shared/hub-install-key.ts): made on first use and kept in the keychain
 * vault under `taalcut-hub`, then served to the agent process alone, as one more provider of the credentials
 * service it already asks (MAIN_SERVICE_CONTRACTS.agent, never appContract). Concurrent first uses share one
 * read, so two hub writes can't make two keys.
 */
import { randomBytes } from 'node:crypto';
import { createToken, hubInstallKeySchema, ok, type AsyncResult } from '@taalcut/core';
import type { AuthBroker, SecretStore } from '@taalcut/models';
import { HUB_INSTALL_KEY_PROVIDER } from '../../shared/hub-install-key';

/** The vault entry. */
export const HUB_INSTALL_KEY_SECRET = 'taalcut-hub';

export type HubInstallKey = () => AsyncResult<string>;
export const MainHubInstallKeyToken = createToken<HubInstallKey>('desktop.mainHubInstallKey');

/** 128 random bits, base64url (22 characters). */
export function newHubInstallKey(): string {
  return randomBytes(16).toString('base64url');
}

export function createHubInstallKey(
  vault: Pick<SecretStore, 'get' | 'set'>,
  mint: () => string = newHubInstallKey,
): HubInstallKey {
  let reading: AsyncResult<string> | undefined;
  const read = async (): AsyncResult<string> => {
    const stored = await vault.get(HUB_INSTALL_KEY_SECRET);
    if (!stored.ok) return stored;
    const kept = hubInstallKeySchema.safeParse(stored.value);
    if (kept.success) return ok(kept.data);
    const key = mint();
    const saved = await vault.set(HUB_INSTALL_KEY_SECRET, key);
    return saved.ok ? ok(key) : saved;
  };
  return () => {
    // A failed read (vault locked) is tried again next time; a good one is kept for the session.
    reading ??= read().then((result) => {
      if (!result.ok) reading = undefined;
      return result;
    });
    return reading;
  };
}

type ServedBroker = Pick<AuthBroker, 'get' | 'invalidate' | 'statuses'>;

/** The broker main serves the agent, answering the hub's provider id with the install key. */
export function withHubInstallKey(broker: ServedBroker, installKey: HubInstallKey): ServedBroker {
  return {
    get: async (provider, request) => {
      if (provider !== HUB_INSTALL_KEY_PROVIDER) return broker.get(provider, request);
      const key = await installKey();
      return key.ok ? ok({ kind: 'api_key', secret: key.value, source: 'keychain' }) : key;
    },
    invalidate: (provider) => {
      if (provider !== HUB_INSTALL_KEY_PROVIDER) broker.invalidate?.(provider);
    },
    statuses: () => broker.statuses(),
  };
}
