// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Verifies a signed component manifest, `{ manifest, signatures: [{ keyId,
 * sig }] }`, against the pinned keys (trusted-keys.ts). The signature is
 * checked over the raw payload before anything in it is read; only then is it
 * validated as a manifest and checked for expiry (`notAfter`) and rollback
 * (`sequence`). Every refusal is a typed `jobs.manifest_untrusted`.
 */
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { err, ok, type Result } from '@taalcut/core';
import { z } from 'zod';
import { ManifestInvalid, ManifestUntrusted, type ManifestRefusal } from '../errors';
import { parseManifest, type ComponentManifest } from '../manifest';
import { MAX_TRUSTED_KEYS, type TrustedKey } from '../trusted-keys';
import { keyIdOf, signedMessage } from './canonical';

export interface VerifiedManifest {
  readonly manifest: ComponentManifest;
  readonly sequence: number;
  /** ISO 8601, UTC. */
  readonly notAfter: string;
  /** The trusted key whose signature was accepted. */
  readonly keyId: string;
}

export interface VerifyOptions {
  readonly trustedKeys: readonly TrustedKey[];
  /** A release build: refuses outright while a development key is trusted. */
  readonly release: boolean;
  /** The highest sequence this install has accepted before (anti-rollback). */
  readonly lastSequence?: number;
  /** Milliseconds since the epoch, for `notAfter`. */
  readonly now: number;
}

const Envelope = z.strictObject({
  manifest: z.record(z.string(), z.unknown()),
  signatures: z
    .array(z.strictObject({ keyId: z.string().regex(/^[0-9a-f]{16}$/), sig: z.base64() }))
    .min(1)
    .max(4),
});

const refuse = (reason: ManifestRefusal, detail: string) => err(ManifestUntrusted({ reason }, { detail }));

export function verifySignedManifest(json: unknown, options: VerifyOptions): Result<VerifiedManifest> {
  const keys = trustedKeyObjects(options);
  if (!keys.ok) return keys;
  const envelope = Envelope.safeParse(json);
  if (!envelope.success) return refuse('unsigned', 'not a signed manifest ({ manifest, signatures })');
  const { manifest: payload, signatures } = envelope.data;

  const byTrustedKey = signatures.filter((s) => keys.value.has(s.keyId));
  if (byTrustedKey.length === 0) {
    const signers = signatures.map((s) => s.keyId).join(', ');
    return refuse(
      'unknown_key',
      `signed by ${signers}; this build trusts ${[...keys.value.keys()].join(', ')}`,
    );
  }
  const message = signedMessage(payload);
  const accepted = byTrustedKey.find((s) => checks(message, s.sig, keys.value.get(s.keyId)!));
  if (!accepted) {
    const signers = byTrustedKey.map((s) => s.keyId).join(', ');
    return refuse('bad_signature', `the signature by ${signers} does not match the manifest`);
  }

  // Only now, with the payload known to be ours, is anything in it read.
  const parsed = parseManifest(payload);
  if (!parsed.ok) return parsed;
  const { sequence, notAfter } = parsed.value;
  if (sequence === undefined || notAfter === undefined) {
    return err(ManifestInvalid(undefined, { detail: 'a signed manifest needs sequence and notAfter' }));
  }
  if (Date.parse(notAfter) <= options.now) return refuse('expired', `notAfter ${notAfter} has passed`);
  if (options.lastSequence !== undefined && sequence < options.lastSequence) {
    return refuse('rollback', `sequence ${sequence} is older than the accepted ${options.lastSequence}`);
  }
  return ok({ manifest: parsed.value, sequence, notAfter, keyId: accepted.keyId });
}

/** The pinned keys by id, after checking the list itself. */
function trustedKeyObjects(options: VerifyOptions): Result<Map<string, KeyObject>> {
  const { trustedKeys } = options;
  if (trustedKeys.length === 0 || trustedKeys.length > MAX_TRUSTED_KEYS) {
    return refuse('key_config', `${trustedKeys.length} trusted keys; pin one or two (current and next)`);
  }
  if (options.release && trustedKeys.some((key) => key.development)) {
    return refuse('development_key', 'a release build must not trust the development key');
  }
  const keys = new Map<string, KeyObject>();
  for (const key of trustedKeys) {
    const raw = Buffer.from(key.publicKey, 'base64url');
    if (raw.length !== 32 || keyIdOf(raw) !== key.keyId || keys.has(key.keyId)) {
      return refuse(
        'key_config',
        `trusted key ${key.keyId} does not match its public key, or is listed twice`,
      );
    }
    keys.set(
      key.keyId,
      createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key.publicKey }, format: 'jwk' }),
    );
  }
  return ok(keys);
}

function checks(message: Buffer, sig: string, key: KeyObject): boolean {
  try {
    return verify(null, message, key, Buffer.from(sig, 'base64'));
  } catch {
    return false; // a signature of the wrong length
  }
}
