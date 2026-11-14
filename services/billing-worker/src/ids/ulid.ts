// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 128-bit ULID: 48-bit timestamp and 80 random bits. Order ids are ULIDs: 26 characters, inside the 40 the payment provider allows a reference. */
export function newUlid(now: number = Date.now()): string {
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  let value = BigInt(now);
  for (const byte of random) value = (value << 8n) | BigInt(byte);
  let out = '';
  for (let index = 0; index < 26; index += 1) {
    out = CROCKFORD.charAt(Number(value & 31n)) + out;
    value >>= 5n;
  }
  return out;
}
