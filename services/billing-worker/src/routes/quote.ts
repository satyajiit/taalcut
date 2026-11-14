// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { fail, invalid, json, rateLimited } from '../http/respond';
import { callerKey, takeBurst } from '../limits/rate-limits';
import { countryOf } from '../http/country';
import { currenciesOf, currencyFor, normaliseRef, priceOf, quoteBody } from '../pricing/quote';
import { type Route } from './route';

/** `GET /v1/health`: the Worker is up, and whether it takes orders. Nothing about why not. */
const health: Route = {
  method: 'GET',
  path: '/v1/health',
  handle: (_request, deps) => Promise.resolve(json({ ok: true, selling: deps.config.selling }, 200)),
};

/**
 * `GET /v1/quote?plan=…[&ref=…][&currency=…]`: what the plan costs right now for a visitor who arrived with `ref`.
 * A `ref` that matches no offer is not an error: visitors arrive with every kind of `ref`, and they are quoted the
 * list price. `currency` is one the plan is sold in, or `auto` for the visitor's own (by the country the request
 * comes from); without it the answer is in the plan's default currency.
 */
const quote: Route = {
  method: 'GET',
  path: '/v1/quote',
  async handle(request, deps) {
    const limit = await takeBurst(deps.readBurst, callerKey(request));
    if (!limit.ok) return rateLimited(limit.retryAfterSeconds);
    const query = new URL(request.url).searchParams;
    const plan = query.get('plan');
    if (plan === null || plan.length === 0) return invalid([{ path: 'plan', rule: 'required' }]);
    const { catalog } = deps.config;
    if (!currenciesOf(catalog, plan)) return fail('billing.not_found', 404);
    const currency = currencyFor(catalog, plan, query.get('currency') ?? undefined, countryOf(request));
    if (currency === null) return invalid([{ path: 'currency', rule: 'unknown' }]);
    const priced = priceOf(catalog, plan, normaliseRef(query.get('ref')), deps.now(), currency);
    if (!priced) return fail('billing.not_found', 404);
    return json(quoteBody(priced, deps.config.selling), 200);
  },
};

export const quoteRoutes: readonly Route[] = [health, quote];
