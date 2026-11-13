// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Signed channel files (security review SB-19, docs/release.md "Signed channel files"). The channel yml
 * electron-updater reads names the version and the zip's sha512, so whoever controls the feed host decides what
 * clients download. Each yml therefore gets a `<file>.sig` beside it: a small JSON envelope with an Ed25519
 * signature over the yml's SHA-256, its channel, when it was signed and when the signature runs out. The app
 * bakes the public key (TAALCUT_UPDATE_PUBLIC_KEY) and refuses a channel file whose signature doesn't verify,
 * names another channel, has run out, or is older than one it already accepted (a replayed file offering a
 * pulled build). The private key lives only in the `release` environment's TAALCUT_UPDATE_SIGNING_KEY secret.
 *
 * The signed text is built here and by the app's verifier (apps/desktop/src/main/update/manifest-envelope.ts);
 * both pin it with the same test vector, so the two can't drift apart.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export const SIGNATURE_SUFFIX = '.sig';
/** How long a signature stays valid. Re-sign (`release.mjs resign`) at least every 60 days. */
export const SIGNATURE_VALIDITY_DAYS = 90;
/** The channel names electron-updater's files carry: `<name>-mac.yml` (stable is `latest`). */
export const SIGNED_CHANNELS = ['latest', 'beta', 'alpha', 'internal'] as const;
export type SignedChannel = (typeof SIGNED_CHANNELS)[number];

export interface ManifestSignature {
  readonly v: 1;
  readonly channel: SignedChannel;
  /** Lowercase hex SHA-256 of the channel file's exact bytes. */
  readonly sha256: string;
  /** ISO 8601, UTC, milliseconds (Date#toISOString). */
  readonly signedAt: string;
  readonly expires: string;
  /** base64 Ed25519 signature (64 bytes) over signedMessage(). */
  readonly sig: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const BASE64_SIG = /^[A-Za-z0-9+/]{86}==$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** PKCS#8 DER prefix of an Ed25519 private key; the 32-byte seed follows. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Domain-separated, one field per line, so no field can be read as another. */
export function signedMessage(fields: Omit<ManifestSignature, 'sig'>): string {
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

/** `latest-mac.yml` → latest. History files and anything else aren't channel files. */
export function channelOfFile(name: string): SignedChannel | undefined {
  const match = /^([a-z]+)-mac\.yml$/.exec(name);
  return SIGNED_CHANNELS.find((channel) => channel === match?.[1]);
}

/** TAALCUT_UPDATE_SIGNING_KEY: a PKCS#8 PEM, or the base64 of its DER. Only an Ed25519 private key. */
export function parseSigningKey(text: string): KeyObject {
  const trimmed = text.trim();
  let key: KeyObject;
  try {
    key = trimmed.startsWith('-----BEGIN')
      ? createPrivateKey(trimmed)
      : createPrivateKey({ key: Buffer.from(trimmed, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    // Never echo the value: it is the key.
    throw new Error('TAALCUT_UPDATE_SIGNING_KEY is not a PKCS#8 private key (PEM or base64 DER)');
  }
  if (key.asymmetricKeyType !== 'ed25519')
    throw new Error('TAALCUT_UPDATE_SIGNING_KEY must be an Ed25519 key');
  return key;
}

/** The raw 32-byte public key, base64: what TAALCUT_UPDATE_PUBLIC_KEY bakes into a build. */
export function publicKeyBase64(key: KeyObject): string {
  const jwk = createPublicKey(key).export({ format: 'jwk' });
  if (typeof jwk.x !== 'string') throw new Error('not an Ed25519 key');
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

/**
 * The packaged update e2e's key, the same on every machine (no key file in the repository). Only test builds bake
 * its public half; a release build refuses to (packaging/build-settings.ts), and `--repo` refuses to sign with it.
 */
export function testSigningKey(): KeyObject {
  const seed = createHash('sha256').update('taalcut update manifest test key: test builds only').digest();
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

export function isTestSigningKey(key: KeyObject): boolean {
  return publicKeyBase64(key) === publicKeyBase64(testSigningKey());
}

/** A `.sig` file's envelope, or undefined when it isn't exactly the shape signManifest writes. */
export function readSignature(text: string): ManifestSignature | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  const keys = Object.keys(fields).sort().join(',');
  if (keys !== 'channel,expires,sha256,sig,signedAt,v' || fields.v !== 1) return undefined;
  const { channel, sha256, signedAt, expires, sig } = fields;
  if (typeof channel !== 'string' || channelOfFile(`${channel}-mac.yml`) === undefined) return undefined;
  if (typeof sha256 !== 'string' || !HEX_SHA256.test(sha256)) return undefined;
  if (
    typeof signedAt !== 'string' ||
    !ISO.test(signedAt) ||
    typeof expires !== 'string' ||
    !ISO.test(expires)
  ) {
    return undefined;
  }
  if (typeof sig !== 'string' || !BASE64_SIG.test(sig)) return undefined;
  return { v: 1, channel: channel as SignedChannel, sha256, signedAt, expires, sig };
}

export interface SignOptions {
  readonly channel: SignedChannel;
  readonly key: KeyObject;
  readonly now: Date;
  /** The `.sig` the file had before: a new signature is never dated before it (clients refuse older ones). */
  readonly previous?: string | undefined;
  readonly validityDays?: number;
}

/** The `.sig` text for `yml` (its exact bytes). */
export function signManifest(yml: string | Uint8Array, options: SignOptions): string {
  const previous = options.previous === undefined ? undefined : readSignature(options.previous);
  const after = previous?.channel === options.channel ? Date.parse(previous.signedAt) + 1 : 0;
  const signed = Math.max(options.now.getTime(), after);
  const days = options.validityDays ?? SIGNATURE_VALIDITY_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 365)
    throw new Error(`validity must be 1–365 days, got ${days}`);
  const fields = {
    v: 1 as const,
    channel: options.channel,
    sha256: createHash('sha256').update(yml).digest('hex'),
    signedAt: new Date(signed).toISOString(),
    expires: new Date(signed + days * DAY_MS).toISOString(),
  };
  const sig = sign(null, Buffer.from(signedMessage(fields)), options.key).toString('base64');
  return `${JSON.stringify({ ...fields, sig })}\n`;
}

/** Whether `sigText` is a valid signature of `yml` for `channel` under `publicKey` (base64 raw), at `now`. */
export function verifyManifest(
  yml: string | Uint8Array,
  sigText: string,
  options: { readonly publicKey: string; readonly channel: SignedChannel; readonly now: Date },
): boolean {
  const envelope = readSignature(sigText);
  if (!envelope || envelope.channel !== options.channel) return false;
  if (createHash('sha256').update(yml).digest('hex') !== envelope.sha256) return false;
  if (options.now.getTime() >= Date.parse(envelope.expires)) return false;
  const key = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(options.publicKey, 'base64').toString('base64url') },
    format: 'jwk',
  });
  const { sig, ...fields } = envelope;
  return verify(null, Buffer.from(signedMessage(fields)), key, Buffer.from(sig, 'base64'));
}
