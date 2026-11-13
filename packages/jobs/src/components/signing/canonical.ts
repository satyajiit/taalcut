// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bytes a manifest signature covers, and key ids. The signer
 * (tools/components/sign-manifest.mjs, plain Node) builds the same bytes with
 * its own copy of these few lines; test/sign-manifest-script.test.ts checks
 * that the two agree.
 *
 * Canonical JSON: no whitespace, object keys sorted by UTF-16 code unit,
 * strings and numbers as JSON.stringify writes them. The message starts with
 * a fixed context line, so a manifest signature can't be passed off as a
 * signature over anything else.
 */
import { createHash } from 'node:crypto';

export const SIGNATURE_CONTEXT = 'taalcut-component-manifest/v1\n';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('not a JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`not a JSON value: ${typeof value}`);
}

/** What is signed: the context line, then the canonical payload, as UTF-8. */
export function signedMessage(payload: unknown): Buffer {
  return Buffer.from(SIGNATURE_CONTEXT + canonicalJson(payload), 'utf8');
}

/** A key's id: the first 16 hex digits of the sha256 of its raw 32-byte Ed25519 public key. */
export function keyIdOf(rawPublicKey: Uint8Array): string {
  return createHash('sha256').update(rawPublicKey).digest('hex').slice(0, 16);
}
