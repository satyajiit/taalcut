// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Ephemeral Ed25519 keys and signed manifests for the signing tests. */
import { createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { keyIdOf, signedMessage, type TrustedKey } from '@taalcut/jobs';
import { componentJson } from './fixtures';

export function newKey(): KeyObject {
  return generateKeyPairSync('ed25519').privateKey;
}

export function trustedKeyFor(privateKey: KeyObject, development?: boolean): TrustedKey {
  const x = createPublicKey(privateKey).export({ format: 'jwk' }).x!;
  return {
    keyId: keyIdOf(Buffer.from(x, 'base64url')),
    publicKey: x,
    ...(development ? { development } : {}),
  };
}

/** `{ manifest, signatures }` with one signature per key, as sign-manifest.mjs writes it. */
export function signedEnvelope(manifest: Record<string, unknown>, ...keys: KeyObject[]) {
  return {
    manifest,
    signatures: keys.map((key) => ({
      keyId: trustedKeyFor(key).keyId,
      sig: sign(null, signedMessage(manifest), key).toString('base64'),
    })),
  };
}

export const NOW = Date.parse('2026-10-12T12:00:00Z');

/** A valid manifest payload with one component, sequence 5, good until 2027. */
export function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sequence: 5,
    notAfter: '2027-04-01T00:00:00Z',
    components: [
      componentJson({
        id: 'parakeet',
        urls: ['https://example.org/p.onnx'],
        size: 10,
        sha256: 'a'.repeat(64),
      }),
    ],
    ...overrides,
  };
}
