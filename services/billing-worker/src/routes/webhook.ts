// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

import { jsonValue } from '../encoding/json-text';
import { readTextBody } from '../http/read-body';
import { fail, invalid, json } from '../http/respond';
import { settle } from '../orders/settle';
import { verifyHmacHex } from '../razorpay/signature';
import { eventSeen, recordEvent } from '../store/d1-events';
import { findOrderByLink } from '../store/d1-orders';
import { type Route } from './route';

const SIGNATURE_HEADER = 'x-razorpay-signature';
const EVENT_ID_HEADER = 'x-razorpay-event-id';

/** All a delivery is used for: which payment link it is about. */
const deliverySchema = z.object({
  event: z.string(),
  payload: z.object({
    payment_link: z.object({ entity: z.object({ id: z.string().regex(/^plink_[A-Za-z0-9]{6,40}$/) }) }),
  }),
});

/**
 * `POST /v1/razorpay/webhook`: the provider's deliveries about payment links.
 *
 * - No secret set: 503, so the provider keeps the delivery and tries again once there is one.
 * - A body that does not carry the secret's signature: 401, and nothing is read from it.
 * - A delivery about a link that is not one of our orders (the account has other products): 200 and nothing done.
 * - Otherwise the order is settled by reading the link from the provider; the delivery's own fields are not used.
 *   A delivery is recorded as handled only after that worked, so a failure is retried by the provider.
 */
const webhook: Route = {
  method: 'POST',
  path: '/v1/razorpay/webhook',
  async handle(request, deps) {
    const secret = deps.config.webhookSecret;
    if (secret === null) return fail('billing.not_selling', 503);
    const body = await readTextBody(request);
    if (!body.ok)
      return invalid([{ path: '', rule: body.reason === 'too-large' ? 'tooLarge' : 'schema' }], 400);
    const signature = request.headers.get(SIGNATURE_HEADER) ?? '';
    if (!(await verifyHmacHex(secret, body.text, signature))) return fail('billing.unauthorized', 401);

    const eventId = request.headers.get(EVENT_ID_HEADER);
    if (eventId !== null && (await eventSeen(deps.db, eventId))) return json({ ok: true }, 200);

    const delivery = deliverySchema.safeParse(jsonValue(body.text));
    const order = delivery.success
      ? await findOrderByLink(deps.db, delivery.data.payload.payment_link.entity.id)
      : null;
    if (order) {
      const settled = await settle(deps, order);
      if (!settled.ok && settled.reason === 'unavailable') return fail('billing.provider_unavailable', 502);
    }
    if (eventId !== null) await recordEvent(deps.db, eventId, deps.now());
    return json({ ok: true }, 200);
  },
};

export const webhookRoutes: readonly Route[] = [webhook];
