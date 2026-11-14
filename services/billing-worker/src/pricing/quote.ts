// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one place a price is decided. The page shows what this returns and the order is charged what this returns;
 * no amount from a browser is ever used.
 */
import { type Catalog, type Offer } from '../config/catalog';

export interface Quote {
  plan: string;
  currency: string;
  /** What is charged now, in minor units. */
  amount: number;
  /** The plan's ordinary price. Equal to `amount` when no offer applies. */
  listAmount: number;
  offer: { id: string; endsAt: number } | null;
}

/** The currency a plan is sold in: USD when it has a USD price, otherwise its first. */
function currencyOf(prices: Readonly<Record<string, number>>): string | undefined {
  return 'USD' in prices ? 'USD' : Object.keys(prices)[0];
}

/** `ref` as it is compared with an offer's code: lower case, or undefined when it could not be a code. */
export function normaliseRef(raw: string | null | undefined): string | undefined {
  const value = raw?.trim().toLowerCase();
  return value !== undefined && /^[a-z0-9_-]{1,40}$/.test(value) ? value : undefined;
}

/** The price of `plan` at `now` for a visitor who arrived with `ref`. Null when the plan is not sold. */
export function priceOf(catalog: Catalog, plan: string, ref: string | undefined, now: number): Quote | null {
  const prices = Object.hasOwn(catalog.plans, plan) ? catalog.plans[plan]?.prices : undefined;
  const currency = prices ? currencyOf(prices) : undefined;
  const listAmount = currency === undefined ? undefined : prices?.[currency];
  if (currency === undefined || listAmount === undefined) return null;

  let best: Offer | undefined;
  for (const offer of catalog.offers) {
    if (offer.plan !== plan || offer.currency !== currency) continue;
    if (now < offer.startsAt || now >= offer.endsAt) continue;
    if (offer.code !== undefined && offer.code !== ref) continue;
    // The lowest price wins. At the same price, the offer that runs longer: its end is the one worth showing.
    if (!best || offer.amount < best.amount || (offer.amount === best.amount && offer.endsAt > best.endsAt))
      best = offer;
  }
  return {
    plan,
    currency,
    amount: best?.amount ?? listAmount,
    listAmount,
    offer: best ? { id: best.id, endsAt: best.endsAt } : null,
  };
}

/** A quote as the API sends it. */
export function quoteBody(quote: Quote, selling: boolean): Record<string, unknown> {
  return {
    plan: quote.plan,
    currency: quote.currency,
    amount: quote.amount,
    listAmount: quote.listAmount,
    offer: quote.offer ? { id: quote.offer.id, endsAt: new Date(quote.offer.endsAt).toISOString() } : null,
    selling,
  };
}
