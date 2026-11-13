// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The main process's secret storage (PRD 8.4). apps/desktop implements
 * SecretStore with Electron safeStorage, so API keys and refresh tokens are
 * encrypted by the OS keychain at rest. This file adapts it to pi-ai's
 * CredentialStore, whose `modify` must be a serialized read-modify-write so two
 * refreshes never race on a rotated refresh token.
 */
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai';
import { createKeyedQueue, ok, type AsyncResult, type Result, type TaalcutError } from '@taalcut/core';

/** Encrypted key-value storage. Keys are not secret; values are. */
export interface SecretStore {
  get(key: string): AsyncResult<string | undefined>;
  set(key: string, value: string): AsyncResult<void>;
  delete(key: string): AsyncResult<void>;
}

/** One entry per provider holds its pi-ai credential as JSON. */
export const credentialSecretKey = (providerId: string): string => `models.credential.${providerId}`;
/** Provider ids that have an entry, so listing never has to try every provider. Not secret. */
const INDEX_KEY = 'models.credential-index';
/** This installation's id, sent to OpenAI as the agent host id. Not secret, but it must persist. */
export const DEVICE_ID_KEY = 'models.device-id';

export interface MemorySecretStore extends SecretStore {
  /** Every stored value, for tests that check where secrets ended up. */
  readonly entries: ReadonlyMap<string, string>;
}

/** In-memory store for tests. Never use it for real secrets. */
export function createMemorySecretStore(): MemorySecretStore {
  const values = new Map<string, string>();
  return {
    entries: values,
    get: async (key) => ok(values.get(key)),
    set: async (key, value) => ok(void values.set(key, value)),
    delete: async (key) => ok(void values.delete(key)),
  };
}

/** Carries a SecretStore failure through pi-ai, which only knows thrown errors. */
export class SecretStoreError extends Error {
  constructor(readonly error: TaalcutError) {
    super(`Secret store failed: ${error.code}`);
    this.name = 'SecretStoreError';
  }
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new SecretStoreError(result.error);
  return result.value;
}

export function secretCredentialStore(secrets: SecretStore): CredentialStore {
  /** Tasks for one key one at a time. */
  const turns = createKeyedQueue();

  async function read(providerId: string): Promise<Credential | undefined> {
    const raw = unwrap(await secrets.get(credentialSecretKey(providerId)));
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as Credential;
    } catch {
      // An unreadable entry counts as signed out; signing in again overwrites it.
      return undefined;
    }
  }

  async function readIndex(): Promise<string[]> {
    const raw = unwrap(await secrets.get(INDEX_KEY));
    try {
      const parsed: unknown = raw === undefined ? [] : JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  const updateIndex = (providerId: string, present: boolean) =>
    turns.run(INDEX_KEY, async () => {
      const ids = new Set(await readIndex());
      if (ids.has(providerId) === present) return;
      if (present) ids.add(providerId);
      else ids.delete(providerId);
      unwrap(await secrets.set(INDEX_KEY, JSON.stringify([...ids].sort())));
    });

  return {
    read: (providerId) => read(providerId),
    async list(): Promise<readonly CredentialInfo[]> {
      const infos: CredentialInfo[] = [];
      for (const providerId of await readIndex()) {
        const credential = await read(providerId);
        if (credential) infos.push({ providerId, type: credential.type });
      }
      return infos;
    },
    modify: (providerId, fn) =>
      turns.run(providerId, async () => {
        const current = await read(providerId);
        const next = await fn(current);
        if (next === undefined) return current;
        unwrap(await secrets.set(credentialSecretKey(providerId), JSON.stringify(next)));
        await updateIndex(providerId, true);
        return next;
      }),
    delete: (providerId) =>
      turns.run(providerId, async () => {
        unwrap(await secrets.delete(credentialSecretKey(providerId)));
        await updateIndex(providerId, false);
      }),
  };
}
