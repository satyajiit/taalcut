// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';

import { createTestBilling, delivery, placeOrder, returnBody } from './harness';

describe('the provider’s deliveries', () => {
  it('make an order paid when the buyer never comes back to the website', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    billing.provider.pay(order.linkId);
    const response = await delivery(billing, order.linkId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    await billing.settled();
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ status: 'paid' })]);
    expect(billing.emails).toHaveLength(2);
    expect(billing.db.snapshot()['provider_events']).toEqual([
      { id: `evt_${order.linkId}`, received_at: billing.clock.now },
    ]);
  });

  it('do nothing the second time the same delivery arrives', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    billing.provider.pay(order.linkId);
    await delivery(billing, order.linkId, { eventId: 'evt_one' });
    const reads = billing.provider.reads;
    expect((await delivery(billing, order.linkId, { eventId: 'evt_one' })).status).toBe(200);
    await billing.settled();
    expect(billing.provider.reads).toBe(reads);
    expect(billing.emails).toHaveLength(2);
  });

  it('tell nobody twice when the delivery, the buyer’s return and the sweep all find the order at once', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    const paymentId = billing.provider.pay(order.linkId);
    billing.clock.now += 3 * 60_000;
    // All three are held inside their read of the link, then let go together.
    const release = billing.provider.hold();
    const racing = [
      delivery(billing, order.linkId),
      billing.post('/v1/orders/confirm', await returnBody(order, paymentId)),
      billing.sweep(),
    ];
    while (billing.provider.reads < 3) await new Promise((resolve) => setTimeout(resolve, 1));
    release();
    await Promise.all(racing);
    await billing.settled();
    expect(billing.provider.reads).toBe(3);
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ status: 'paid' })]);
    expect(billing.emails.map((email) => email.to)).toEqual(['owner@example.com', 'asha@example.com']);
    expect(billing.chats).toHaveLength(1);
  });

  it('are not believed about the amount or the status: the link is read from the provider', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    // A correctly signed delivery that says "paid" about a link nobody paid.
    expect((await delivery(billing, order.linkId)).status).toBe(200);
    await billing.settled();
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ status: 'created' })]);
    expect(billing.emails).toEqual([]);
  });

  it('are refused without the webhook secret’s signature, and nothing is read from them', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    billing.provider.pay(order.linkId);
    const forged = await delivery(billing, order.linkId, { secret: 'a-guess-at-the-secret' });
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ code: 'billing.unauthorized' });
    const unsigned = await billing.request('/v1/razorpay/webhook', { method: 'POST', body: '{}' });
    expect(unsigned.status).toBe(401);
    // The key secret signs the return, not a delivery.
    const wrongKey = await delivery(billing, order.linkId, { secret: 'test-key-secret-not-a-secret' });
    expect(wrongKey.status).toBe(401);
    await billing.settled();
    expect(billing.provider.reads).toBe(0);
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ status: 'created' })]);
    expect(billing.db.snapshot()['provider_events']).toEqual([]);
  });

  it('are answered 503 until a webhook secret is set, so the provider keeps them', async () => {
    const billing = createTestBilling({ env: { RAZORPAY_WEBHOOK_SECRET: undefined } });
    const response = await delivery(billing, 'plink_Test000001');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'billing.not_selling' });
  });

  it('about links that are not our orders, or about anything else, are accepted and ignored', async () => {
    const billing = createTestBilling();
    expect((await delivery(billing, 'plink_SomeoneElse01')).status).toBe(200);
    const other = await delivery(billing, 'unused', {
      eventId: 'evt_sub',
      body: JSON.stringify({
        event: 'subscription.charged',
        payload: { subscription: { entity: { id: 'sub_1' } } },
      }),
    });
    expect(other.status).toBe(200);
    expect((await delivery(billing, 'unused', { eventId: 'evt_text', body: 'not json' })).status).toBe(200);
    expect(billing.provider.reads).toBe(0);
  });

  it('are asked for again when the provider could not be read', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    billing.provider.pay(order.linkId);
    billing.provider.away = true;
    const failed = await delivery(billing, order.linkId, { eventId: 'evt_retry' });
    expect(failed.status).toBe(502);
    expect(billing.db.snapshot()['provider_events']).toEqual([]);
    billing.provider.away = false;
    expect((await delivery(billing, order.linkId, { eventId: 'evt_retry' })).status).toBe(200);
    await billing.settled();
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ status: 'paid' })]);
  });

  it('close an order whose link ran out', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    billing.provider.close(order.linkId, 'expired');
    await delivery(billing, order.linkId, { event: 'payment_link.expired' });
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ status: 'expired' })]);
  });
});
