// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two signatures the payment provider makes, both HMAC-SHA256 in lower-case hex:
 *
 * - the return to the website carries one over `link id|reference|status|payment id`, keyed with the key secret;
 * - a delivery to the webhook carries one over the body's exact bytes, keyed with the webhook secret.
 *
 * A valid signature only says who sent the values. What an order is worth is still read from the provider.
 */

const encoder = new TextEncoder();

/** The hex as bytes, or null when it is not 64 hex characters. */
function signatureBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1)
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** WebCrypto's key type (the Worker's lib has no DOM `CryptoKey`). */
type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<HmacKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    usage,
  ]);
}

/** True when `signature` is the HMAC of `message` under `secret`. WebCrypto compares in constant time. */
export async function verifyHmacHex(secret: string, message: string, signature: string): Promise<boolean> {
  const bytes = signatureBytes(signature);
  if (!bytes) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), bytes, encoder.encode(message));
}

/** The signature the provider would make. Only the tests and the fake provider sign. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const digest = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), encoder.encode(message));
  let out = '';
  for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, '0');
  return out;
}

export interface ReturnValues {
  orderId: string;
  linkId: string;
  paymentId: string;
  status: string;
}

/** What the return's signature is over, in the provider's order. */
export function returnMessage(values: ReturnValues): string {
  return `${values.linkId}|${values.orderId}|${values.status}|${values.paymentId}`;
}
