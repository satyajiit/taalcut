// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one place a price is decided. The page shows what this returns and the order is charged what this returns;
 * no amount from a browser is ever used. A browser may say which of the plan's currencies it wants, never how much.
 */
import { type Catalog, type Offer } from '../config/catalog';

export interface Quote {
  plan: string;
  currency: string;
  /** Every currency the plan is sold in, its default first. */
  currencies: readonly string[];
  /** What is charged now, in minor units. */
  amount: number;
  /** The plan's ordinary price. Equal to `amount` when no offer applies. */
  listAmount: number;
  offer: { id: string; endsAt: number } | null;
}

/** What a caller writes to be quoted in its visitor's own currency. */
export const AUTO_CURRENCY = 'auto';

/** The currencies a plan is sold in, its default first: USD when it has a USD price. Null when it is not sold. */
export function currenciesOf(catalog: Catalog, plan: string): readonly string[] | null {
  const prices = Object.hasOwn(catalog.plans, plan) ? catalog.plans[plan]?.prices : undefined;
  const all = prices ? Object.keys(prices) : [];
  if (all.length === 0) return null;
  return all.includes('USD') ? ['USD', ...all.filter((currency) => currency !== 'USD')] : all;
}

/**
 * The currency for a request: the one it names when the plan is sold in it; for `auto`, the currency the catalogue
 * gives the visitor's country, when the plan is sold in that; and the plan's default when it names none, so a page
 * that knows one currency keeps getting it. Null when the plan is not sold or the named currency is not one of its.
 */
export function currencyFor(
  catalog: Catalog,
  plan: string,
  asked: string | undefined,
  country: string | null,
): string | null {
  const currencies = currenciesOf(catalog, plan);
  if (!currencies) return null;
  const fallback = currencies[0] ?? null;
  if (asked === undefined) return fallback;
  if (asked !== AUTO_CURRENCY) return currencies.includes(asked) ? asked : null;
  const local =
    country !== null && Object.hasOwn(catalog.currencyByCountry, country)
      ? catalog.currencyByCountry[country]
      : undefined;
  return local !== undefined && currencies.includes(local) ? local : fallback;
}

/** `ref` as it is compared with an offer's code: lower case, or undefined when it could not be a code. */
export function normaliseRef(raw: string | null | undefined): string | undefined {
  const value = raw?.trim().toLowerCase();
  return value !== undefined && /^[a-z0-9_-]{1,40}$/.test(value) ? value : undefined;
}

/**
 * The price of `plan` at `now`, in `currency` (the plan's default when none is given), for a visitor who arrived
 * with `ref`. Null when the plan is not sold, or not in that currency.
 */
export function priceOf(
  catalog: Catalog,
  plan: string,
  ref: string | undefined,
  now: number,
  currency?: string,
): Quote | null {
  const currencies = currenciesOf(catalog, plan);
  const chosen = currency ?? currencies?.[0];
  if (!currencies || chosen === undefined || !currencies.includes(chosen)) return null;
  const listAmount = catalog.plans[plan]?.prices[chosen];
  if (listAmount === undefined) return null;

  let best: Offer | undefined;
  for (const offer of catalog.offers) {
    if (offer.plan !== plan || offer.currency !== chosen) continue;
    if (now < offer.startsAt || now >= offer.endsAt) continue;
    if (offer.code !== undefined && offer.code !== ref) continue;
    // The lowest price wins. At the same price, the offer that runs longer: its end is the one worth showing.
    if (!best || offer.amount < best.amount || (offer.amount === best.amount && offer.endsAt > best.endsAt))
      best = offer;
  }
  return {
    plan,
    currency: chosen,
    currencies,
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
    currencies: quote.currencies,
  };
}
