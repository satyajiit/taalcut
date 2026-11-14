// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The order form, as the server reads it. Every field is checked here whatever the page checked, and each thing
 * wrong is named by field and rule so the page can say it beside the field.
 */
import { type Problem } from '../http/respond';

export interface CheckoutInput {
  plan: string;
  ref: string | undefined;
  /** The currency of the price the page showed. Whether the plan is sold in it is the pricing's to say. */
  currency: string | undefined;
  name: string;
  email: string;
  /** Required: the payment provider makes no payment page without a phone number. `+` and 8 to 15 digits. */
  whatsapp: string;
  channel: string | null;
  /** The amount the page showed, in minor units. */
  expect: number | undefined;
}

export type CheckoutRead = { ok: true; input: CheckoutInput } | { ok: false; problems: Problem[] };

const FIELDS = new Set([
  'plan',
  'ref',
  'currency',
  'name',
  'email',
  'whatsapp',
  'channel',
  'agreed',
  'expect',
]);
const EMAIL = /^[^\s@<>"',;:\\]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const CHANNEL = /^(https?:\/\/[^\s<>"']{4,}|@[A-Za-z0-9._]{1,60})$/;

/** Control characters, and the ones that reorder or hide text: none belongs in a name or a link. */
function hasUnsafe(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x200e || code === 0x200f) return true;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
  }
  return false;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : undefined;
}

/** A phone number with its country code: `+`, then 8 to 15 digits. Spaces, dashes, dots and brackets are dropped. */
function phone(value: string): string | null {
  const compact = value.replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

export function readCheckout(value: unknown): CheckoutRead {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { ok: false, problems: [{ path: '', rule: 'schema' }] };
  const body: Record<string, unknown> = { ...value };
  const problems: Problem[] = [];
  for (const key of Object.keys(body)) if (!FIELDS.has(key)) problems.push({ path: key, rule: 'unknown' });

  const plan = text(body['plan']);
  if (!plan) problems.push({ path: 'plan', rule: 'required' });

  const name = text(body['name']);
  if (!name) problems.push({ path: 'name', rule: 'required' });
  else if (name.length < 2) problems.push({ path: 'name', rule: 'tooShort' });
  else if (name.length > 80) problems.push({ path: 'name', rule: 'tooLong' });
  else if (hasUnsafe(name)) problems.push({ path: 'name', rule: 'format' });

  const email = text(body['email']);
  if (!email) problems.push({ path: 'email', rule: 'required' });
  else if (email.length > 254) problems.push({ path: 'email', rule: 'tooLong' });
  else if (!EMAIL.test(email) || hasUnsafe(email)) problems.push({ path: 'email', rule: 'format' });

  const rawWhatsapp = text(body['whatsapp']);
  const whatsapp = rawWhatsapp ? phone(rawWhatsapp) : null;
  if (body['whatsapp'] !== undefined && body['whatsapp'] !== null && typeof body['whatsapp'] !== 'string')
    problems.push({ path: 'whatsapp', rule: 'format' });
  else if (!rawWhatsapp) problems.push({ path: 'whatsapp', rule: 'required' });
  else if (whatsapp === null) problems.push({ path: 'whatsapp', rule: 'format' });

  const channel = text(body['channel']) || null;
  if (body['channel'] !== undefined && body['channel'] !== null && typeof body['channel'] !== 'string')
    problems.push({ path: 'channel', rule: 'format' });
  else if (channel !== null && channel.length > 200) problems.push({ path: 'channel', rule: 'tooLong' });
  else if (channel !== null && (!CHANNEL.test(channel) || hasUnsafe(channel)))
    problems.push({ path: 'channel', rule: 'format' });

  // Agreement is the literal `true`: nothing a form library might send in its place counts.
  if (body['agreed'] !== true) problems.push({ path: 'agreed', rule: 'required' });

  const expect = body['expect'];
  if (expect !== undefined && (typeof expect !== 'number' || !Number.isSafeInteger(expect) || expect < 0))
    problems.push({ path: 'expect', rule: 'format' });

  const ref = body['ref'];
  if (ref !== undefined && typeof ref !== 'string') problems.push({ path: 'ref', rule: 'format' });

  const currency = body['currency'];
  if (currency !== undefined && (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)))
    problems.push({ path: 'currency', rule: 'format' });

  if (problems.length > 0 || !plan || !name || !email || whatsapp === null) return { ok: false, problems };
  return {
    ok: true,
    input: {
      plan,
      ref: typeof ref === 'string' ? ref : undefined,
      currency: typeof currency === 'string' ? currency : undefined,
      name,
      email,
      whatsapp,
      channel,
      expect: typeof expect === 'number' ? expect : undefined,
    },
  };
}
