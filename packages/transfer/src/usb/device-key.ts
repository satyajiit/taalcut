// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * deviceKey and itemKey. A USB serial is hashed here and nowhere else:
 * callers pass it in and keep the 16-character key. Never log the input.
 */
import { createHash } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * base32(sha256(identity)).slice(0, 16). `identity` is the serial, or the location id when there is none.
 * Only letters and digits count, upper-cased: the USB serial of an iPhone is its UDID without the hyphen
 * ImageCaptureCore's `serialNumberString` may keep, and both must land on one card.
 */
export function deviceKey(identity: string): string {
  const normal = identity.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return keyOf(normal.length > 0 ? normal : identity);
}

/** base32(sha256(itemId)).slice(0, 16). Item ids are not serials. */
export function itemKey(itemId: string): string {
  return keyOf(itemId);
}

function keyOf(text: string): string {
  return base32(createHash('sha256').update(text, 'utf8').digest()).slice(0, 16);
}

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += at(value, bits);
    }
  }
  if (bits > 0) out += at(value << (5 - bits), 0);
  return out;
}

function at(value: number, shift: number): string {
  const index = (value >> shift) & 31;
  return ALPHABET.charAt(index);
}
