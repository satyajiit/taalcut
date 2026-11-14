// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { fail, invalid, json, rateLimited } from '../http/respond';
import { callerKey, takeBurst } from '../limits/rate-limits';
import { normaliseRef, priceOf, quoteBody } from '../pricing/quote';
import { type Route } from './route';

/** `GET /v1/health`: the Worker is up, and whether it takes orders. Nothing about why not. */
const health: Route = {
  method: 'GET',
  path: '/v1/health',
  handle: (_request, deps) => Promise.resolve(json({ ok: true, selling: deps.config.selling }, 200)),
};

/**
 * `GET /v1/quote?plan=…[&ref=…]`: what the plan costs right now for a visitor who arrived with `ref`. A `ref` that
 * matches no offer is not an error: visitors arrive with every kind of `ref`, and they are quoted the list price.
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
    const priced = priceOf(deps.config.catalog, plan, normaliseRef(query.get('ref')), deps.now());
    if (!priced) return fail('billing.not_found', 404);
    return json(quoteBody(priced, deps.config.selling), 200);
  },
};

export const quoteRoutes: readonly Route[] = [health, quote];
