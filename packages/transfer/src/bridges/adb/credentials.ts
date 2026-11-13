// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AdbCredentialStore over the one key main holds. The library's authenticators
 * turn the PKCS#8 buffer into the mincrypt public key and AUTH signatures;
 * node:crypto only checks the bytes are a single RSA-2048 key before that.
 * The key is never written and never logged.
 */
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { type AdbCredentialStore, type AdbKeyIterable, type AdbPrivateKey } from '@yume-chan/adb';

export interface AdbKeySource {
  /** PKCS#8 DER. Never log, never write to disk. */
  pkcs8(): Promise<Uint8Array>;
}

const KEY_NAME = 'taalcut';

export function createAdbCredentialStore(source: AdbKeySource): AdbCredentialStore {
  return {
    generateKey: () => loadKey(source),
    iterateKeys: () => iterate(source),
  };
}

function iterate(source: AdbKeySource): AdbKeyIterable {
  return (async function* () {
    yield await loadKey(source);
  })();
}

async function loadKey(source: AdbKeySource): Promise<AdbPrivateKey> {
  const incoming = await source.pkcs8();
  const buffer = new Uint8Array(incoming.byteLength);
  buffer.set(incoming);
  assertRsa(buffer);
  return { buffer, name: KEY_NAME };
}

/** Reject anything the daemon would not accept. The signature is discarded. */
function assertRsa(pkcs8: Uint8Array): void {
  let key;
  try {
    key = createPrivateKey({ key: Buffer.from(pkcs8), format: 'der', type: 'pkcs8' });
  } catch {
    throw keyRejected();
  }
  if (key.asymmetricKeyType !== 'rsa') throw keyRejected();
  const details = key.asymmetricKeyDetails;
  if (details?.modulusLength !== undefined && details.modulusLength !== 2048) throw keyRejected();
  if (details?.publicExponent !== undefined && details.publicExponent !== 65537n) throw keyRejected();
  createPublicKey(key);
  sign('sha256', Buffer.from('adb'), key);
}

function keyRejected(): Error {
  const error = new Error('adb-key');
  error.name = 'AdbKeyRejected';
  return error;
}
