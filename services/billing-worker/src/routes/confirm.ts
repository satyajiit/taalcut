// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

import { readJsonBody } from '../http/read-body';
import { fail, invalid, json, rateLimited, unreadable } from '../http/respond';
import { callerKey, takeBurst } from '../limits/rate-limits';
import { activateBy } from '../notify/messages';
import { settle } from '../orders/settle';
import { returnMessage, verifyHmacHex } from '../razorpay/signature';
import { findOrder, type Order } from '../store/d1-orders';
import { type Route } from './route';

/** The five values the provider appends to the return address, under the API's own names. */
const returnSchema = z
  .object({
    orderId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    linkId: z.string().regex(/^plink_[A-Za-z0-9]{6,40}$/),
    paymentId: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/),
    status: z.string().regex(/^[a-z_]{1,30}$/),
    signature: z.string().regex(/^[0-9a-f]{64}$/i),
  })
  .strict();

/** What the thanks page may know: the outcome and the dates. No name, no address, no payment reference. */
export function publicOrder(order: Order): Record<string, unknown> {
  return {
    orderId: order.id,
    status: order.status === 'created' || order.status === 'failed' ? 'pending' : order.status,
    plan: order.plan,
    currency: order.currency,
    amount: order.amount,
    paidAt: order.paidAt === null ? null : new Date(order.paidAt).toISOString(),
    activateBy: order.paidAt === null ? null : new Date(activateBy(order.paidAt)).toISOString(),
  };
}

/**
 * `POST /v1/orders/confirm`: the buyer is back from the payment page. The signature shows the values came from the
 * provider and were not typed into the address bar; the order's outcome is then read from the provider itself.
 */
const confirm: Route = {
  method: 'POST',
  path: '/v1/orders/confirm',
  async handle(request, deps) {
    const limit = await takeBurst(deps.readBurst, callerKey(request));
    if (!limit.ok) return rateLimited(limit.retryAfterSeconds);
    const body = await readJsonBody(request);
    if (!body.ok) return unreadable(body);
    const parsed = returnSchema.safeParse(body.value);
    if (!parsed.success)
      return invalid(parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), rule: 'format' })));
    const values = parsed.data;

    const keys = deps.config.provider;
    if (!keys) return fail('billing.not_selling', 503);
    if (!(await verifyHmacHex(keys.keySecret, returnMessage(values), values.signature)))
      return invalid([{ path: 'signature', rule: 'signature' }]);

    const order = await findOrder(deps.db, values.orderId);
    // The same answer for "no such order" and "not this order's link": nothing to probe with.
    if (!order || order.linkId !== values.linkId) return fail('billing.not_found', 404);

    const settled = await settle(deps, order);
    if (settled.ok) return json(publicOrder(settled.order), 200);
    return settled.reason === 'mismatch'
      ? fail('billing.busy', 500)
      : fail('billing.provider_unavailable', 502);
  },
};

export const confirmRoutes: readonly Route[] = [confirm];
