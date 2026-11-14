// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The billing service's API, version 1, as the site reads it. Every answer's shape is checked here before a page uses
 * it: a body that isn't what the contract says is `unexpected`, never a crash and never a half-read price. Amounts are
 * the minor units of the answer's own currency (US cents, Indian paise). Pure, so every branch has a test.
 */

export interface Offer {
  /** The service's own id ('product-hunt', 'launch-day'); the site names it from content/premium.ts. */
  readonly id: string;
  /** When the offer ends, as an ISO instant. */
  readonly endsAt: string;
}

export interface Quote {
  readonly plan: string;
  /** The currency this quote is in: the one the service picked for the visitor's country, or the one asked for. */
  readonly currency: string;
  /** What an order costs now. */
  readonly amount: number;
  readonly listAmount: number;
  readonly offer: Offer | null;
  /** Whether the service takes orders at all. */
  readonly selling: boolean;
  /** Every currency the plan is sold in, this quote's own among them. An answer that lists none has only its own. */
  readonly currencies: readonly string[];
}

/** What a quote may be asked in: the currency for the visitor's country, or a code the plan is sold in. */
export const AUTO_CURRENCY = 'auto';
/** A currency's code as the service writes one: three capitals. */
export const isCurrencyCode = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z]{3}$/.test(value);

export interface Checkout {
  readonly orderId: string;
  /** The payment provider's page for this order. */
  readonly payUrl: string;
  readonly currency: string;
  readonly amount: number;
}

export const ORDER_STATUSES = ['paid', 'pending', 'expired', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Confirmation {
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly plan: string;
  readonly currency: string;
  readonly amount: number;
  readonly paidAt: string | null;
  readonly activateBy: string | null;
}

/** What the page sends to start an order. `expect` is the amount it showed, in `currency`, the quote's own. */
export interface CheckoutRequest {
  readonly plan: string;
  readonly ref?: string;
  readonly name: string;
  readonly email: string;
  /** `+`, then 8 to 15 digits. Required: the payment provider makes no payment page without a phone number. */
  readonly whatsapp: string;
  readonly channel?: string;
  readonly agreed: true;
  /** The code of the quote the page showed, never `auto`: without it the service prices the order in dollars. */
  readonly currency: string;
  readonly expect: number;
}

/** The five values the payment provider appends to the return address. */
export interface ConfirmRequest {
  readonly orderId: string;
  readonly linkId: string;
  readonly paymentId: string;
  readonly status: string;
  readonly signature: string;
}

export interface Problem {
  readonly path: string;
  readonly rule: string;
}

/** Why a request didn't give its answer: the service's refusals, then the ways a request can fail to reach it. */
export type FailureKind =
  | 'invalid'
  | 'not-found'
  | 'price-changed'
  | 'rate-limited'
  | 'busy'
  | 'provider-unavailable'
  | 'not-selling'
  | 'forbidden'
  | 'offline'
  | 'timeout'
  | 'unreachable'
  | 'unexpected';

export interface BillingFailure {
  readonly kind: FailureKind;
  /** `invalid`: what the service refused, field by field. */
  readonly problems?: readonly Problem[];
  /** `rate-limited`: how long the service asks to wait. */
  readonly retryAfterSeconds?: number;
  /** `price-changed`: the price as it is now. */
  readonly quote?: Quote;
}

export type BillingResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: BillingFailure };

type Fields = Readonly<Record<string, unknown>>;

function fields(value: unknown): Fields | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : null;
}

const text = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const currency = isCurrencyCode;
const instant = (value: unknown): value is string => text(value, 40) && !Number.isNaN(Date.parse(value));

function parseOffer(value: unknown): Offer | null | undefined {
  if (value === null) return null;
  const f = fields(value);
  if (!f || !text(f.id, 60) || !instant(f.endsAt)) return undefined;
  return { id: f.id, endsAt: f.endsAt };
}

/** How many currencies a plan may list before the answer stops looking like one. */
const CURRENCIES_MAX = 12;

/**
 * The currencies a quote lists: codes, each once, the quote's own among them. A missing field is the quote's own
 * currency alone (an older answer); anything else that isn't such a list makes the answer no quote.
 */
function parseCurrencies(value: unknown, own: string): readonly string[] | null {
  if (value === undefined) return [own];
  if (!Array.isArray(value) || value.length === 0 || value.length > CURRENCIES_MAX) return null;
  const codes = value.filter(currency);
  if (codes.length !== value.length || new Set(codes).size !== codes.length || !codes.includes(own))
    return null;
  return codes;
}

export function parseQuote(value: unknown): Quote | null {
  const f = fields(value);
  if (!f) return null;
  const offer = parseOffer(f.offer);
  if (offer === undefined) return null;
  if (!text(f.plan, 40) || !currency(f.currency) || !amount(f.amount) || !amount(f.listAmount)) return null;
  const currencies = parseCurrencies(f.currencies, f.currency);
  if (currencies === null) return null;
  // A price above the list price, a lower one that names no offer, or a boolean that isn't one, is not a quote.
  if (
    f.amount > f.listAmount ||
    (f.amount < f.listAmount && offer === null) ||
    typeof f.selling !== 'boolean'
  )
    return null;
  return {
    plan: f.plan,
    currency: f.currency,
    amount: f.amount,
    listAmount: f.listAmount,
    offer,
    selling: f.selling,
    currencies,
  };
}

/** A payment page is an https address: the page sends the browser nowhere else. */
export function isPayUrl(value: unknown): value is string {
  if (!text(value, 2048)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    // Not an address.
    return false;
  }
}

export function parseCheckout(value: unknown): Checkout | null {
  const f = fields(value);
  if (!f || !text(f.orderId, 64) || !isPayUrl(f.payUrl) || !currency(f.currency) || !amount(f.amount))
    return null;
  return { orderId: f.orderId, payUrl: f.payUrl, currency: f.currency, amount: f.amount };
}

export function parseConfirmation(value: unknown): Confirmation | null {
  const f = fields(value);
  if (!f || !text(f.orderId, 64) || !text(f.plan, 40) || !currency(f.currency) || !amount(f.amount))
    return null;
  const status = ORDER_STATUSES.find((s) => s === f.status);
  if (!status) return null;
  if (f.paidAt !== null && !instant(f.paidAt)) return null;
  if (f.activateBy !== null && !instant(f.activateBy)) return null;
  return {
    orderId: f.orderId,
    status,
    plan: f.plan,
    currency: f.currency,
    amount: f.amount,
    paidAt: f.paidAt,
    activateBy: f.activateBy,
  };
}

function parseProblems(value: unknown): Problem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const f = fields(item);
    return f && typeof f.path === 'string' && text(f.rule, 60)
      ? [{ path: f.path.slice(0, 60), rule: f.rule }]
      : [];
  });
}

const CODES: Readonly<Record<string, FailureKind>> = {
  'billing.invalid': 'invalid',
  'billing.not_found': 'not-found',
  'billing.price_changed': 'price-changed',
  'billing.rate_limited': 'rate-limited',
  'billing.busy': 'busy',
  'billing.provider_unavailable': 'provider-unavailable',
  'billing.not_selling': 'not-selling',
  // The service takes orders from the website's own pages only: a copy of the page elsewhere is refused.
  'billing.forbidden': 'forbidden',
};

/**
 * A refusal, from its body's `code`. A refusal the contract doesn't name is `unexpected`, as is a changed price that
 * comes without a quote the page can show.
 */
export function parseFailure(body: unknown): BillingFailure {
  const f = fields(body);
  const kind = f && typeof f.code === 'string' ? CODES[f.code] : undefined;
  if (!f || !kind) return { kind: 'unexpected' };
  if (kind === 'invalid') return { kind, problems: parseProblems(f.problems) };
  if (kind === 'rate-limited') {
    const wait = f.retryAfterSeconds;
    return typeof wait === 'number' && Number.isFinite(wait) && wait > 0
      ? { kind, retryAfterSeconds: Math.ceil(wait) }
      : { kind };
  }
  if (kind === 'price-changed') {
    const quote = parseQuote(f.quote);
    return quote ? { kind, quote } : { kind: 'unexpected' };
  }
  return { kind };
}
