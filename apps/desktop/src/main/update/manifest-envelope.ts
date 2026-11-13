// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Checks a channel file's signature (security review SB-19). The release scripts write `<file>.sig` beside each
 * channel yml (scripts/rollout/manifest-signature.ts): `{ v, channel, sha256, signedAt, expires, sig }`, with an
 * Ed25519 signature over signedMessage(). This build trusts one public key, baked at build time
 * (TAALCUT_UPDATE_PUBLIC_KEY). Pure: the caller fetches the bytes and keeps the last accepted time.
 *
 * Order matters: the signature is checked before any field is believed, so an unsigned envelope can't steer which
 * error is reported; a valid signature over other bytes is a mismatch (a yml changed after signing, or a stale
 * CDN copy), not an untrusted file.
 */
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { err, ok, type Result } from '@taalcut/core';
import { z } from 'zod';
import {
  UpdateManifestMismatch,
  UpdateManifestStale,
  UpdateManifestUnreadable,
  UpdateManifestUntrusted,
} from './manifest-errors';

/** The channel names the update library's files carry (`<name>-mac.yml`; stable is `latest`). */
export const MANIFEST_CHANNELS = ['latest', 'beta', 'alpha', 'internal'] as const;
export type ManifestChannel = (typeof MANIFEST_CHANNELS)[number];

/** The largest `.sig` read: the envelope is about 300 bytes. */
export const MAX_SIGNATURE_BYTES = 2048;

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
export const manifestEnvelopeSchema = z.strictObject({
  v: z.literal(1),
  channel: z.enum(MANIFEST_CHANNELS),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  signedAt: iso,
  expires: iso,
  sig: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
});
export type ManifestEnvelope = z.output<typeof manifestEnvelopeSchema>;

/** The exact text the release scripts sign; the same test vector pins both sides. */
export function signedMessage(fields: Omit<ManifestEnvelope, 'sig'>): string {
  return [
    'taalcut-update-manifest',
    `v=${fields.v}`,
    `channel=${fields.channel}`,
    `sha256=${fields.sha256}`,
    `signedAt=${fields.signedAt}`,
    `expires=${fields.expires}`,
    '',
  ].join('\n');
}

/** The baked key: base64 of the raw 32-byte Ed25519 public key. */
export function manifestKey(publicKeyBase64: string): Result<KeyObject> {
  const raw = Buffer.from(publicKeyBase64, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== publicKeyBase64) {
    return err(
      UpdateManifestUntrusted({ channel: '' }, { detail: 'the baked update key is not 32 bytes of base64' }),
    );
  }
  return ok(
    createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' }),
  );
}

/** `latest` for the update library's default channel. */
export function manifestChannel(channel: string | undefined): ManifestChannel | undefined {
  const name = channel?.trim() || 'latest';
  return MANIFEST_CHANNELS.find((known) => known === name);
}

export interface EnvelopeCheck {
  /** The `.sig` file's text. */
  readonly envelope: string;
  /** The channel file's exact bytes. */
  readonly yml: Uint8Array;
  readonly key: KeyObject;
  readonly channel: ManifestChannel;
  /** Epoch ms. */
  readonly now: number;
  /** signedAt (epoch ms) of the last file this Mac accepted on this channel. */
  readonly lastAccepted?: number | undefined;
}

function parsed(text: string, channel: ManifestChannel): Result<ManifestEnvelope> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err(UpdateManifestUnreadable({ channel }, { detail: 'the signature file is not JSON' }));
  }
  const envelope = manifestEnvelopeSchema.safeParse(json);
  return envelope.success
    ? ok(envelope.data)
    : err(UpdateManifestUnreadable({ channel }, { detail: 'the signature file has the wrong shape' }));
}

/** The accepted file's signedAt (epoch ms), or why it is refused. */
export function checkEnvelope(input: EnvelopeCheck): Result<{ readonly signedAt: number }> {
  const { channel } = input;
  const read = parsed(input.envelope, channel);
  if (!read.ok) return read;
  const { sig, ...fields } = read.value;
  if (!verify(null, Buffer.from(signedMessage(fields)), input.key, Buffer.from(sig, 'base64'))) {
    return err(
      UpdateManifestUntrusted({ channel }, { detail: 'the signature does not verify with this build’s key' }),
    );
  }
  if (fields.channel !== channel) {
    return err(UpdateManifestUntrusted({ channel }, { detail: `signed for the ${fields.channel} channel` }));
  }
  if (createHash('sha256').update(input.yml).digest('hex') !== fields.sha256) {
    return err(UpdateManifestMismatch({ channel }, { detail: 'the channel file is not the one signed' }));
  }
  const signedAt = Date.parse(fields.signedAt);
  if (input.now >= Date.parse(fields.expires)) {
    return err(UpdateManifestStale({ channel }, { detail: `the signature ran out at ${fields.expires}` }));
  }
  if (input.lastAccepted !== undefined && signedAt < input.lastAccepted) {
    return err(
      UpdateManifestStale(
        { channel },
        { detail: `signed ${fields.signedAt}, before the file already accepted (a replay)` },
      ),
    );
  }
  return ok({ signedAt });
}
