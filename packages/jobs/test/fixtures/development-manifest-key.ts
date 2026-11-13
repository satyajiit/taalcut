// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DEVELOPMENT manifest signing key: the private half of DEVELOPMENT_MANIFEST_KEY
 * in src/components/trusted-keys.ts.
 *
 * NOT A SECRET. It is committed on purpose so tests (and anyone building a
 * development app) can sign manifests. A release build refuses to start the
 * component manager while this key is trusted. The release key is created by
 * the owner with `node tools/components/sign-manifest.mjs --generate` and
 * never enters the repository.
 */
import { createPrivateKey, type KeyObject } from 'node:crypto';

export const DEVELOPMENT_MANIFEST_PRIVATE_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: '0CGB_weNWnZdANDGOd-yS8ISJS858xg-s7syKJpjfZA',
  d: '9FW9vGJedaMw19q8LadtSUiZ7uLEMqwCQWUP37yEd7A',
} as const;

export const developmentManifestPrivateKey = (): KeyObject =>
  createPrivateKey({ key: { ...DEVELOPMENT_MANIFEST_PRIVATE_JWK }, format: 'jwk' });
