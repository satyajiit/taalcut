// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The adb RSA key for the lan process (P3-B5). Generated once, kept in the
 * keychain vault as `adb-key`, and never logged. Settings → Privacy forgets
 * it, so the next phone asks to allow USB debugging again.
 */
import { generateKeyPairSync } from 'node:crypto';
import { createSerialQueue, deviceKeysContract, implementContract, unwrapRpc } from '@taalcut/core';
import type { SecretStore } from '@taalcut/models';

const ADB_KEY = 'adb-key';

export function deviceKeysRouter(store: SecretStore) {
  const os = implementContract(deviceKeysContract);
  /** Reading, making and forgetting the key one at a time, so two phones never make two keys. */
  const turns = createSerialQueue();
  return os.router({
    adbKey: os.adbKey.handler(() =>
      turns.run(async () => {
        const existing = unwrapRpc(await store.get(ADB_KEY));
        if (existing !== undefined) return { pkcs8: existing };
        const pkcs8 = generateAdbKey();
        unwrapRpc(await store.set(ADB_KEY, pkcs8));
        return { pkcs8 };
      }),
    ),
    forgetAdbKey: os.forgetAdbKey.handler(() =>
      turns.run(async () => {
        const existing = unwrapRpc(await store.get(ADB_KEY));
        if (existing === undefined) return { forgotten: false };
        unwrapRpc(await store.delete(ADB_KEY));
        return { forgotten: true };
      }),
    ),
  });
}

/** RSA-2048 PKCS#8 DER, base64. The bytes stay in the return value and nowhere else. */
function generateAdbKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 65537,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return privateKey.toString('base64');
}
