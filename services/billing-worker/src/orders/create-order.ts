// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Takes an order in two steps. `priceOrder` decides what it costs and refuses what cannot be sold, and spends
 * nothing: a refused order makes no link and uses no limit. `createOrder` then writes the order down and has the
 * payment provider make its link. The order is written before the link exists, so a link is never out in the
 * world without an order that names it.
 */
import { type BillingDeps } from '../deps';
import { newUlid } from '../ids/ulid';
import { logInfo } from '../log';
import { priceOf, normaliseRef, type Quote } from '../pricing/quote';
import { attachLink, insertOrder, markFailed } from '../store/d1-orders';
import { type CheckoutInput } from './checkout-input';

/** How long a link can be paid. The price it was made with holds that long, even past an offer's end. */
export const LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;

export type Priced =
  | { ok: true; quote: Quote }
  | { ok: false; reason: 'unknown_plan' }
  | { ok: false; reason: 'price_changed'; quote: Quote };

export function priceOrder(deps: Pick<BillingDeps, 'config' | 'now'>, input: CheckoutInput): Priced {
  const quote = priceOf(deps.config.catalog, input.plan, normaliseRef(input.ref), deps.now());
  if (!quote) return { ok: false, reason: 'unknown_plan' };
  // The buyer agreed to the amount on the page. If it is no longer the price, they are shown the new one first.
  if (input.expect !== undefined && input.expect !== quote.amount)
    return { ok: false, reason: 'price_changed', quote };
  return { ok: true, quote };
}

export type Created =
  | { ok: true; orderId: string; payUrl: string }
  | { ok: false; reason: 'not_selling' | 'provider_unavailable' };

type CreateDeps = Pick<BillingDeps, 'db' | 'config' | 'provider' | 'now'>;

export async function createOrder(
  deps: CreateDeps,
  input: CheckoutInput,
  quote: Quote,
  country: string | null,
): Promise<Created> {
  const { config } = deps;
  if (!config.selling || !deps.provider) return { ok: false, reason: 'not_selling' };
  const now = deps.now();
  const id = newUlid(now);
  const expiresAt = now + LINK_LIFETIME_MS;
  await insertOrder(deps.db, {
    id,
    mode: config.mode,
    plan: quote.plan,
    currency: quote.currency,
    amount: quote.amount,
    listAmount: quote.listAmount,
    offerId: quote.offer?.id ?? null,
    name: input.name,
    email: input.email,
    whatsapp: input.whatsapp,
    channel: input.channel,
    country,
    createdAt: now,
    expiresAt,
  });

  const label = config.catalog.plans[quote.plan]?.label ?? quote.plan;
  const made = await deps.provider.createLink({
    amount: quote.amount,
    currency: quote.currency,
    referenceId: id,
    description: `${label}: one month`,
    customer: { name: input.name, email: input.email, contact: input.whatsapp },
    returnUrl: `${config.siteOrigin}/premium/thanks/`,
    expireBy: Math.floor(expiresAt / 1000),
    notes: { taalcut_order: id, taalcut_plan: quote.plan, taalcut_offer: quote.offer?.id ?? 'none' },
  });
  if (!made.ok) {
    await markFailed(deps.db, id);
    return { ok: false, reason: 'provider_unavailable' };
  }
  await attachLink(deps.db, id, made.value.id);
  logInfo('billing.order_created', { order: id, mode: config.mode });
  return { ok: true, orderId: id, payUrl: made.value.url };
}
