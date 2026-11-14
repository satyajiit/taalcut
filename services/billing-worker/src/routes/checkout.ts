// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { countryOf } from '../http/country';
import { readJsonBody } from '../http/read-body';
import { fail, invalid, json, rateLimited, unreadable } from '../http/respond';
import { callerKey, takeCheckout } from '../limits/rate-limits';
import { readCheckout } from '../orders/checkout-input';
import { createOrder, priceOrder } from '../orders/create-order';
import { quoteBody } from '../pricing/quote';
import { type Route } from './route';

/**
 * `POST /v1/checkout`: the order form. The answer is the address of the payment page; the page sends the buyer
 * there. Everything that can refuse an order without the provider (the form's fields, the plan, the price the
 * page showed) is checked before a limit is spent, so only an order that would make a link uses one up.
 */
const checkout: Route = {
  method: 'POST',
  path: '/v1/checkout',
  async handle(request, deps) {
    const body = await readJsonBody(request);
    if (!body.ok) return unreadable(body);
    const read = readCheckout(body.value);
    if (!read.ok) return invalid(read.problems);
    const keys = deps.config.provider;
    if (!deps.config.selling || !keys) return fail('billing.not_selling', 503);

    const priced = priceOrder(deps, read.input);
    if (!priced.ok) {
      if (priced.reason === 'price_changed')
        return fail('billing.price_changed', 409, { quote: quoteBody(priced.quote, deps.config.selling) });
      return invalid([{ path: priced.reason === 'unknown_plan' ? 'plan' : 'currency', rule: 'unknown' }]);
    }

    const limit = await takeCheckout(
      { db: deps.db, burst: deps.checkoutBurst, hashKey: keys.keySecret },
      callerKey(request),
      deps.now(),
    );
    if (!limit.ok) return rateLimited(limit.retryAfterSeconds);

    const made = await createOrder(deps, read.input, priced.quote, countryOf(request));
    if (made.ok)
      return json(
        {
          orderId: made.orderId,
          payUrl: made.payUrl,
          currency: priced.quote.currency,
          amount: priced.quote.amount,
        },
        201,
      );
    if (made.reason === 'not_selling') return fail('billing.not_selling', 503);
    // A phone number the provider would not take is the buyer's to put right, like any other field.
    if (made.reason === 'contact_refused') return invalid([{ path: 'whatsapp', rule: 'format' }]);
    return fail('billing.provider_unavailable', 502);
  },
};

export const checkoutRoutes: readonly Route[] = [checkout];
