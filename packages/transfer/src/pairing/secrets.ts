// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { TransferPlatform, TransferRandom } from '../deps';

/** Crockford base32, no I, L, O or U. Matches the setup-code regex. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function systemRandom(): TransferRandom {
  return {
    bytes: (n) => randomBytes(n),
    int: (max) => randomInt(0, max),
  };
}

export interface PairingSecrets {
  readonly token: string;
  readonly code: string;
  readonly pin: string;
}

export function mintPairing(random: TransferRandom): PairingSecrets {
  return {
    token: random.bytes(16).toString('base64url'),
    code: crockford40(random.bytes(5)),
    pin: String(random.int(1_000_000)).padStart(6, '0'),
  };
}

export function mintCredential(random: TransferRandom): string {
  return random.bytes(32).toString('base64url');
}

/** Constant-time string compare. A length mismatch fails without comparing the bytes. */
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function qrText(url: string, token: string): string {
  return `${url}/#k=${token}`;
}

export function sessionUrl(address: string, port: number): string {
  return `http://${address}:${port}`;
}

/**
 * Words a browser sends where the model would be, which name no model (UX1-IMPORT): Chrome's reduced User-Agent
 * sends "K" (and Android 10 for the version), which named every Chrome phone "K"; Firefox sends "Mobile" or "Tablet".
 */
const REDUCED_MODEL = new Set(['K', 'Mobile', 'Tablet']);

/** Label and platform from the browser's user agent. The body's device name is ignored. */
export function describeDevice(userAgent: string): { label: string; platform: TransferPlatform } {
  const ua = userAgent.slice(0, 400);
  if (/iPad/.test(ua)) return { label: 'iPad', platform: 'ios' };
  if (/iPhone/.test(ua)) return { label: 'iPhone', platform: 'ios' };
  const model = /Android [^;)]*;\s*([^;)]+)/.exec(ua)?.[1]?.trim();
  if (model && !REDUCED_MODEL.has(model)) return { label: plainLabel(model), platform: 'android' };
  // Without a model, what the User-Agent does say: Chrome marks phones "Mobile" and leaves it out on tablets.
  if (/Android/.test(ua))
    return { label: /Mobile/.test(ua) ? 'Android phone' : 'Android tablet', platform: 'android' };
  return { label: 'Phone', platform: 'other' };
}

function plainLabel(value: string): string {
  let out = '';
  for (const char of value.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += char;
  }
  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 60) : 'Android';
}

function crockford40(bytes: Buffer): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out = CROCKFORD[Number(value & 31n)]! + out;
    value >>= 5n;
  }
  return out;
}
