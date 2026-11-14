// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  type BillingFailure,
  type BillingResult,
  type Checkout,
  type CheckoutRequest,
  type Confirmation,
  type ConfirmRequest,
  type Quote,
  parseCheckout,
  parseConfirmation,
  parseFailure,
  parseQuote,
} from './api';
import { billingBase } from './origin';

/**
 * The three calls the site makes to the billing service (its API, version 1: api.ts). Each returns its answer or the
 * one cause it failed for; nothing here throws. No cookies or credentials travel: the service keys an order by what
 * the form sends.
 */

/** How long a call waits before it says the service didn't answer. */
export const BILLING_TIMEOUT_MS = 12_000;

export interface BillingClientOptions {
  readonly base?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** `navigator.onLine`, for telling a dropped connection from a service that can't be reached. */
  readonly online?: () => boolean;
}

export interface BillingClient {
  quote(plan: string, ref: string | null): Promise<BillingResult<Quote>>;
  checkout(order: CheckoutRequest): Promise<BillingResult<Checkout>>;
  confirm(values: ConfirmRequest): Promise<BillingResult<Confirmation>>;
}

const failed = (failure: BillingFailure): { ok: false; failure: BillingFailure } => ({ ok: false, failure });

export function createBillingClient(options: BillingClientOptions = {}): BillingClient {
  const base = options.base ?? billingBase();
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? BILLING_TIMEOUT_MS;
  const online = options.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  async function call<T>(
    path: string,
    body: unknown,
    parse: (value: unknown) => T | null,
  ): Promise<BillingResult<T>> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let response: Response;
    let payload: unknown;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers:
          body === undefined
            ? { accept: 'application/json' }
            : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
        signal: abort.signal,
      });
      // The body is read inside the wait: a service that sends headers and stalls is still a service that didn't answer.
      payload = await response.json().catch(() => undefined);
      if (abort.signal.aborted) return failed({ kind: 'timeout' });
    } catch {
      // The request never got an answer: aborted by the wait, or refused by the network.
      if (abort.signal.aborted) return failed({ kind: 'timeout' });
      return failed({ kind: online() ? 'unreachable' : 'offline' });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return failed(parseFailure(payload));
    const value = parse(payload);
    return value === null ? failed({ kind: 'unexpected' }) : { ok: true, value };
  }

  return {
    quote(plan, ref) {
      const query = new URLSearchParams({ plan });
      if (ref) query.set('ref', ref);
      return call(`/v1/quote?${query.toString()}`, undefined, (value) => {
        const quote = parseQuote(value);
        // A quote for another plan is not this page's price.
        return quote && quote.plan === plan ? quote : null;
      });
    },
    checkout(order) {
      return call('/v1/checkout', order, parseCheckout);
    },
    confirm(values) {
      return call('/v1/orders/confirm', values, (value) => {
        const confirmation = parseConfirmation(value);
        // An answer about another order is not this one's.
        return confirmation && confirmation.orderId === values.orderId ? confirmation : null;
      });
    },
  };
}
