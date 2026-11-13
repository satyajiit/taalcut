// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The public keys this build trusts to sign the component manifest: at most
 * two, the current key and the next one, so a key can be rotated without a
 * gap (ship the next key as trusted, sign with both, later drop the old one).
 *
 * Pinned: the release key, whose private half is in the owner's keychain
 * (`taalcut-manifest-key`, tools/components/README.md, "The manifest key").
 * The development key is never pinned here: its private half is committed in
 * test/fixtures, so anyone can sign with it. Tests pass it explicitly, and a
 * release build refuses to start the component manager if it is ever trusted
 * (loadSignedManifest with `release: true` returns `jobs.manifest_untrusted`,
 * reason `development_key`).
 */

export interface TrustedKey {
  /** keyIdOf(the raw public key): the first 16 hex digits of its sha256. */
  readonly keyId: string;
  /** The raw 32-byte Ed25519 public key, base64url (a JWK's `x`). */
  readonly publicKey: string;
  /** A key whose private half is not secret. A release build never trusts it. */
  readonly development?: boolean;
}

/** Current + next. */
export const MAX_TRUSTED_KEYS = 2;

/** DEVELOPMENT ONLY, never pinned. Private half: test/fixtures/development-manifest-key.ts. Not a secret. */
export const DEVELOPMENT_MANIFEST_KEY: TrustedKey = {
  keyId: '258809ecbe41f222',
  publicKey: '0CGB_weNWnZdANDGOd-yS8ISJS858xg-s7syKJpjfZA',
  development: true,
};

export const TRUSTED_MANIFEST_KEYS: readonly TrustedKey[] = [
  // The release key (2026-10-25).
  { keyId: '438da86c0fbd96ef', publicKey: 'WTxzM4MziWNU8ESfRHdhxz4T-DxJGH19G8e8HvECpng' },
];
