// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { EMAIL_MAX, type EmailProblem, emailProblem, normalizeEmail } from '#lib/email';
import type { CheckoutRequest, ConfirmRequest, Problem } from './api';

/**
 * The order form's answers, checked and put in the shape the billing service takes, before anything is sent. The
 * service checks them again: these checks only save a round trip and say what to fix. Pure, for the tests.
 */

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const CHANNEL_MAX = 200;

export interface OrderAnswers {
  readonly name: string;
  readonly email: string;
  readonly whatsapp: string;
  readonly channel: string;
  readonly agreed: boolean;
}

/**
 * An address as the billing service takes one: nothing before the @ that a mail header treats as punctuation, and
 * plain letters, digits and hyphens in each part after it. Case doesn't matter. The service runs the same pattern.
 */
export const ORDER_EMAIL = /^[^\s@<>"',;:\\]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Control characters, and the ones that reorder or hide text: none belongs in a name or an address. */
export function hasUnsafe(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x200e || code === 0x200f) return true;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
  }
  return false;
}

/** `characters`: the address has the shape of one, with a character the billing service doesn't take. */
export type OrderEmailProblem = EmailProblem | 'characters';

/** What is wrong with an address, by the billing service's own rule, so a refusal shows beside the field first. */
export function orderEmailProblem(raw: string): OrderEmailProblem | null {
  const email = normalizeEmail(raw);
  if (email.length === 0) return 'empty';
  if (email.length > EMAIL_MAX) return 'too-long';
  if (ORDER_EMAIL.test(email) && !hasUnsafe(email)) return null;
  // The site's plain check names a missing @ or a space; anything it lets through is a character out of place.
  return emailProblem(raw) === 'malformed' ? 'malformed' : 'characters';
}

export const ORDER_FIELDS = ['name', 'email', 'whatsapp', 'channel', 'agreed'] as const;
export type OrderField = (typeof ORDER_FIELDS)[number];

export type OrderProblem =
  | { readonly field: 'name'; readonly problem: 'empty' | 'too-short' | 'too-long' }
  | { readonly field: 'email'; readonly problem: OrderEmailProblem }
  | { readonly field: 'whatsapp'; readonly problem: 'empty' | 'malformed' }
  | { readonly field: 'channel'; readonly problem: 'malformed' | 'too-long' }
  | { readonly field: 'agreed'; readonly problem: 'missing' }
  /** A field the billing service refused without a rule the form knows. */
  | { readonly field: OrderField; readonly problem: 'refused' };

/**
 * A WhatsApp number as the service takes it: `+`, the country code, then the number, 8 to 15 digits in all. Spaces,
 * hyphens, dots and brackets are dropped, and a leading 00 reads as `+`. Empty stays empty (the form then asks for it:
 * the payment provider makes no payment page without a phone number); null when what's left isn't a number.
 */
export function normalizeWhatsapp(raw: string): string | null {
  const typed = raw.trim();
  if (typed.length === 0) return '';
  const digits = typed.replace(/[\s\-.()]/g, '').replace(/^00/, '+');
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** A handle as the service takes one: `@`, then letters, digits, dots and underscores. */
const HANDLE = /^@[A-Za-z0-9._]{1,60}$/;

/**
 * A channel as the service takes it: an http(s) address with a real host, or an `@handle`. `instagram.com/name` gains
 * `https://`. Empty stays empty; null when it is neither; 'too-long' over CHANNEL_MAX.
 */
export function normalizeChannel(raw: string): string | null | 'too-long' {
  const typed = raw.trim();
  if (typed.length === 0) return '';
  if (typed.startsWith('@')) return HANDLE.test(typed) ? typed : null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    // Not an address.
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !/^[^\s.]+(\.[^\s.]+)+$/.test(url.hostname) || url.username !== '')
    return null;
  // What the service refuses in a link, the form refuses first.
  if (/[<>"']/.test(url.href)) return null;
  return url.href.length > CHANNEL_MAX ? 'too-long' : url.href;
}

/** A name as the service reads it: trimmed, its runs of spaces single. */
export function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** What is wrong with the answers, in the form's order; empty when they can be sent. */
export function orderProblems(answers: OrderAnswers): OrderProblem[] {
  const problems: OrderProblem[] = [];
  const name = cleanName(answers.name);
  if (name.length === 0) problems.push({ field: 'name', problem: 'empty' });
  else if (name.length < NAME_MIN) problems.push({ field: 'name', problem: 'too-short' });
  else if (name.length > NAME_MAX) problems.push({ field: 'name', problem: 'too-long' });
  else if (hasUnsafe(name)) problems.push({ field: 'name', problem: 'refused' });
  const email = orderEmailProblem(answers.email);
  if (email) problems.push({ field: 'email', problem: email });
  const whatsapp = normalizeWhatsapp(answers.whatsapp);
  if (whatsapp === '') problems.push({ field: 'whatsapp', problem: 'empty' });
  else if (whatsapp === null) problems.push({ field: 'whatsapp', problem: 'malformed' });
  const channel = normalizeChannel(answers.channel);
  if (channel === null) problems.push({ field: 'channel', problem: 'malformed' });
  else if (channel === 'too-long') problems.push({ field: 'channel', problem: 'too-long' });
  if (!answers.agreed) problems.push({ field: 'agreed', problem: 'missing' });
  return problems;
}

/**
 * The request for an order, or null while the answers have a problem. `expect` is the amount the page shows and
 * `currency` the currency it shows it in: both are the quote's own.
 */
export function checkoutRequest(
  answers: OrderAnswers,
  order: {
    readonly plan: string;
    readonly ref: string | null;
    readonly currency: string;
    readonly expect: number;
  },
): CheckoutRequest | null {
  const whatsapp = normalizeWhatsapp(answers.whatsapp);
  if (orderProblems(answers).length > 0 || !whatsapp) return null;
  const channel = normalizeChannel(answers.channel);
  return {
    plan: order.plan,
    ...(order.ref ? { ref: order.ref } : {}),
    name: cleanName(answers.name),
    email: normalizeEmail(answers.email),
    whatsapp,
    ...(typeof channel === 'string' && channel !== 'too-long' && channel.length > 0 ? { channel } : {}),
    agreed: true,
    currency: order.currency,
    expect: order.expect,
  };
}

/** The form's field a refusal's path names (`name`, `/email`, `body.whatsapp`), or null when it names none. */
export function fieldOf(path: string): OrderField | null {
  const last = path
    .split(/[/.[\]]+/)
    .filter(Boolean)
    .at(-1);
  return ORDER_FIELDS.find((field) => field === last) ?? null;
}

/**
 * The service's refusals as the form's problems: one for each field it names, each once. An order without the number
 * (`whatsapp`, `required`) gets the form's own words for it; any other refusal has no rule the form knows.
 */
export function refusedFields(problems: readonly Problem[]): OrderProblem[] {
  const named = new Set(problems.flatMap((p) => fieldOf(p.path) ?? []));
  const noNumber = problems.some((p) => fieldOf(p.path) === 'whatsapp' && p.rule === 'required');
  return ORDER_FIELDS.filter((field) => named.has(field)).map((field) =>
    field === 'whatsapp' && noNumber ? { field, problem: 'empty' } : { field, problem: 'refused' },
  );
}

/** The query values the payment provider appends to the return address, by the name the service takes each under. */
export const RETURN_KEYS: Readonly<Record<keyof ConfirmRequest, string>> = {
  orderId: 'razorpay_payment_link_reference_id',
  linkId: 'razorpay_payment_link_id',
  paymentId: 'razorpay_payment_id',
  status: 'razorpay_payment_link_status',
  signature: 'razorpay_signature',
};

/** The five values from a return address's query string, or null unless all five are there and of a sane length. */
export function returnValues(search: string): ConfirmRequest | null {
  const query = new URLSearchParams(search);
  const read = (key: keyof ConfirmRequest) => query.get(RETURN_KEYS[key])?.trim() ?? '';
  const values: ConfirmRequest = {
    orderId: read('orderId'),
    linkId: read('linkId'),
    paymentId: read('paymentId'),
    status: read('status'),
    signature: read('signature'),
  };
  return Object.values(values).every((value) => value.length > 0 && value.length <= 256) ? values : null;
}
