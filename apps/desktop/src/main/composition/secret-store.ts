// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The keychain vault (models SPEC, "What apps/desktop implements"): models'
 * SecretStore over Electron safeStorage, which encrypts with a key the OS
 * keeps: the macOS keychain, or on Linux the session's keyring (GNOME Keyring
 * or KWallet, through libsecret). Values are encrypted one by one and kept in
 * a 0600 JSON file in userData; keys (provider ids) are not secret. Without
 * encryption the store refuses (models.secret_store_failed): nothing is ever
 * written in the clear. Electron is injected so this is unit-tested.
 *
 * On Linux without a keyring, safeStorage still "encrypts", with a fixed key
 * ('basic_text'), which is as good as the clear; the platform's policy says
 * so (platform/linux.ts), and the store refuses with desktop.keyring_unavailable,
 * whose message says a keyring is needed. Nothing already stored is touched.
 *
 * Only safeStorage's asynchronous encryptor, whose keychain work runs off
 * main's thread. When macOS has to ask the person first (no keychain under
 * HOME, a locked one), the synchronous calls held main's thread inside the
 * system's keychain prompt until someone answered, so every window and every
 * process call froze with it; now only the vault call waits for the answer.
 * Calls still take effect one at a time, in the order they were made.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSerialQueue, defineError, err, ok } from '@taalcut/core';
import { SecretStoreFailed, type SecretStore } from '@taalcut/models';
import type { SecretStorePolicy, StorageBackendPort } from '../../platform/types';

/**
 * The session has no system keyring (GNOME Keyring, KWallet), so safeStorage would encrypt with a fixed key. Not
 * retryable: Chromium picks its backend when the app starts, so the fix is a keyring and a restart.
 */
export const KeyringUnavailable = defineError<{ operation: string }>('desktop.keyring_unavailable');

/** The part of Electron's safeStorage used here: the asynchronous encryptor, and on Linux which backend it uses. */
export interface SafeStorageLike extends StorageBackendPort {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ readonly shouldReEncrypt: boolean; readonly result: string }>;
}

const refused = (operation: string, detail: string) => err(SecretStoreFailed({ operation }, { detail }));

export function createVaultSecretStore(
  file: string,
  safe: SafeStorageLike,
  policy: SecretStorePolicy,
): SecretStore {
  let cache: Record<string, string> | undefined;
  /** Each call after every call made before it. Each operation answers with a Result and never rejects. */
  const turns = createSerialQueue();

  const load = (): Record<string, string> => {
    if (cache) return cache;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      cache = parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      cache = {};
    }
    return cache;
  };

  const save = (next: Record<string, string>): void => {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    renameSync(temp, file);
    cache = next;
  };

  /** A rejection is the keychain refusing (the person declined, or there is none): encryption unavailable. */
  const available = (): Promise<boolean> => safe.isAsyncEncryptionAvailable().catch(() => false);

  /**
   * Whether a value may be encrypted or decrypted now: encryption available, and its key kept by a keyring. Asked
   * after availability, which is when Chromium has settled on its backend.
   */
  const usable = async (operation: string) => {
    if (!(await available())) return refused(operation, 'encryption unavailable');
    const refusal = policy.refusal(safe);
    return refusal === null ? ok(undefined) : err(KeyringUnavailable({ operation }, { detail: refusal }));
  };

  /** Re-encrypts under the newer key decryptStringAsync asked for; if that fails, the old one still reads. */
  const reEncrypt = async (key: string, value: string): Promise<void> => {
    try {
      save({ ...load(), [key]: (await safe.encryptStringAsync(value)).toString('base64') });
    } catch {
      console.warn('[vault] a value could not be re-encrypted under the newer key; it is kept as it was');
    }
  };

  return {
    get: (key) =>
      turns.run(async () => {
        const stored = load()[key];
        if (stored === undefined) return ok(undefined);
        const can = await usable('get');
        if (!can.ok) return can;
        let decrypted: { readonly shouldReEncrypt: boolean; readonly result: string };
        try {
          decrypted = await safe.decryptStringAsync(Buffer.from(stored, 'base64'));
        } catch {
          // Never the value or the exception text: it may quote what it couldn't decrypt.
          return refused('get', 'could not decrypt');
        }
        if (decrypted.shouldReEncrypt) await reEncrypt(key, decrypted.result);
        return ok(decrypted.result);
      }),
    set: (key, value) =>
      turns.run(async () => {
        const can = await usable('set');
        if (!can.ok) return can;
        try {
          const encrypted = (await safe.encryptStringAsync(value)).toString('base64');
          save({ ...load(), [key]: encrypted });
          return ok(undefined);
        } catch {
          return refused('set', 'could not write the vault');
        }
      }),
    delete: (key) =>
      turns.run(async () => {
        const { [key]: _removed, ...rest } = load();
        try {
          save(rest);
          return ok(undefined);
        } catch {
          return refused('delete', 'could not write the vault');
        }
      }),
  };
}
