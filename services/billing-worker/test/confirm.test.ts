// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';

import { BUYER, createTestBilling, placeOrder, returnBody } from './harness';

const PAID_AT = '2026-11-18T00:00:00.000Z';
const ACTIVE_BY = '2026-11-25T00:00:00.000Z';

describe('the return from the payment page', () => {
  it('makes the order paid once the provider says the link is paid, and tells us and the buyer', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    const paymentId = billing.provider.pay(order.linkId);
    const response = await billing.post('/v1/orders/confirm', await returnBody(order, paymentId));
    expect(response.status).toBe(200);
    // The page learns the outcome and the dates. No name, address or payment reference comes back.
    expect(await response.json()).toEqual({
      orderId: order.orderId,
      status: 'paid',
      plan: 'premium',
      currency: 'USD',
      amount: 40000,
      paidAt: PAID_AT,
      activateBy: ACTIVE_BY,
    });
    await billing.settled();
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({
        status: 'paid',
        payment_id: paymentId,
        paid_at: billing.clock.now,
        owner_notified_at: billing.clock.now,
        buyer_notified_at: billing.clock.now,
      }),
    ]);

    expect(billing.emails.map((email) => [email.to, email.subject])).toEqual([
      ['owner@example.com', `Taalcut Premium: paid order ${order.orderId}`],
      ['asha@example.com', 'Your Taalcut Premium payment is in'],
    ]);
    const [toUs, toBuyer] = billing.emails;
    expect(toUs?.replyTo).toBe('asha@example.com');
    expect(toUs?.text).toContain('WhatsApp: +14155550100');
    expect(toUs?.text).toContain('Paid: $400.00');
    expect(toUs?.text).not.toContain('TEST MODE');
    expect(toUs?.text).toContain('Active by: 25 November 2026');
    expect(toBuyer?.from).toEqual({ email: 'premium@taalcut.app', name: 'Taalcut' });
    expect(toBuyer?.replyTo).toBe('owner@example.com');
    expect(toBuyer?.text).toContain('We have your payment of $400.00 for Taalcut Premium.');
    expect(toBuyer?.text).toContain('by 25 November 2026');
    expect(toBuyer?.text).toContain('we refund the payment in full');
    expect(toBuyer?.html).toContain('<p>Hi Asha Rao,</p>');
    expect(billing.chats).toHaveLength(1);
    expect(billing.chats[0]).toContain(order.orderId);
  });

  it('confirms a rupee order in rupees, and writes rupees in both messages', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing, { currency: 'INR' });
    const paymentId = billing.provider.pay(order.linkId);
    const response = await billing.post('/v1/orders/confirm', await returnBody(order, paymentId));
    expect(await response.json()).toMatchObject({ status: 'paid', currency: 'INR', amount: 3760000 });
    await billing.settled();
    const [toUs, toBuyer] = billing.emails;
    expect(toUs?.text).toContain('Paid: ₹37,600.00');
    expect(toBuyer?.text).toContain('We have your payment of ₹37,600.00 for Taalcut Premium.');
  });

  it('tells nobody twice when the buyer comes back twice', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    const body = await returnBody(order, billing.provider.pay(order.linkId));
    await billing.post('/v1/orders/confirm', body);
    const again = await billing.post('/v1/orders/confirm', body);
    expect(await again.json()).toMatchObject({ status: 'paid', paidAt: PAID_AT });
    await billing.settled();
    expect(billing.emails).toHaveLength(2);
    expect(billing.chats).toHaveLength(1);
    // A paid order is not looked up again.
    expect(billing.provider.reads).toBe(1);
  });

  it('does not believe a signed return about a link the provider has not marked paid', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    // The values are signed correctly, as a replayed or forged-with-a-leaked-key return would be.
    const response = await billing.post('/v1/orders/confirm', await returnBody(order, 'pay_Never000000'));
    expect(await response.json()).toMatchObject({ status: 'pending', paidAt: null, activateBy: null });
    await billing.settled();
    expect(billing.emails).toEqual([]);
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ status: 'created' })]);
  });

  it('refuses values that were not signed with the key secret', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    const paymentId = billing.provider.pay(order.linkId);
    const signed = await returnBody(order, paymentId);
    for (const body of [
      await returnBody(order, paymentId, { secret: 'another-secret-entirely' }),
      { ...signed, status: 'created' },
      { ...signed, paymentId: 'pay_Other000000' },
      { ...signed, signature: 'f'.repeat(64) },
    ]) {
      const response = await billing.post('/v1/orders/confirm', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: 'billing.invalid',
        problems: [{ path: 'signature', rule: 'signature' }],
      });
    }
    const malformed = await billing.post('/v1/orders/confirm', { ...signed, signature: 'nope', extra: 1 });
    expect(malformed.status).toBe(400);
    expect(billing.provider.reads).toBe(0);
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ status: 'created' })]);
  });

  it('answers "not found" for an order that does not exist and for another order’s link alike', async () => {
    const billing = createTestBilling();
    const first = await placeOrder(billing);
    const second = await placeOrder(billing, { email: 'other@example.com' });
    const paymentId = billing.provider.pay(second.linkId);
    const crossed = await returnBody(first, paymentId, { linkId: second.linkId });
    const unknown = await returnBody(first, paymentId, { orderId: '01KA0000000000000000000000' });
    for (const body of [crossed, unknown]) {
      const response = await billing.post('/v1/orders/confirm', body);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ code: 'billing.not_found' });
    }
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ id: first.orderId, status: 'created' }),
      expect.objectContaining({ id: second.orderId, status: 'created' }),
    ]);
  });

  it('does not make an order paid when the provider’s link is for another amount, currency or order', async () => {
    for (const change of [
      { amount: 100, amountPaid: 100 },
      { currency: 'INR' },
      { referenceId: '01KA0000000000000000000000' },
    ]) {
      const billing = createTestBilling();
      const order = await placeOrder(billing);
      const paymentId = billing.provider.pay(order.linkId);
      billing.provider.rewrite(order.linkId, change);
      const response = await billing.post('/v1/orders/confirm', await returnBody(order, paymentId));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ code: 'billing.busy' });
      await billing.settled();
      expect(billing.emails).toEqual([]);
      expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ status: 'created' })]);
    }
  });

  it('does not make an order paid by a part payment', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    const paymentId = billing.provider.pay(order.linkId);
    billing.provider.rewrite(order.linkId, { amountPaid: 39999 });
    const response = await billing.post('/v1/orders/confirm', await returnBody(order, paymentId));
    expect(await response.json()).toMatchObject({ status: 'pending' });
  });

  it('says so when the provider cannot be asked, and settles on the next try', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    const body = await returnBody(order, billing.provider.pay(order.linkId));
    billing.provider.away = true;
    const down = await billing.post('/v1/orders/confirm', body);
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ code: 'billing.provider_unavailable' });
    billing.provider.away = false;
    expect(await (await billing.post('/v1/orders/confirm', body)).json()).toMatchObject({ status: 'paid' });
  });

  it('reports a link that ran out or was cancelled', async () => {
    for (const status of ['expired', 'cancelled'] as const) {
      const billing = createTestBilling();
      const order = await placeOrder(billing);
      billing.provider.close(order.linkId, status);
      const response = await billing.post('/v1/orders/confirm', await returnBody(order, 'pay_Late0000000'));
      expect(await response.json()).toMatchObject({ status, paidAt: null });
    }
  });

  it('makes a closed order paid when the provider says the money came after all', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    billing.provider.close(order.linkId, 'expired');
    const late = await returnBody(order, 'pay_Late0000000');
    expect(await (await billing.post('/v1/orders/confirm', late)).json()).toMatchObject({
      status: 'expired',
    });
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ status: 'expired' })]);

    const paymentId = billing.provider.pay(order.linkId);
    const response = await billing.post('/v1/orders/confirm', await returnBody(order, paymentId));
    expect(await response.json()).toMatchObject({ status: 'paid', paidAt: PAID_AT });
    await billing.settled();
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ status: 'paid', payment_id: paymentId }),
    ]);
    expect(billing.emails.map((email) => email.to)).toEqual(['owner@example.com', 'asha@example.com']);
  });

  it('still confirms a payment after selling is switched off, and not without the key pair', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    const body = await returnBody(order, billing.provider.pay(order.linkId));
    billing.env.SELLING = 'off';
    expect((await billing.post('/v1/checkout', BUYER)).status).toBe(503);
    expect(await (await billing.post('/v1/orders/confirm', body)).json()).toMatchObject({ status: 'paid' });

    Reflect.deleteProperty(billing.env, 'RAZORPAY_KEY_SECRET');
    expect((await billing.post('/v1/orders/confirm', body)).status).toBe(503);
  });

  it('limits how often one caller may confirm', async () => {
    const billing = createTestBilling({ readLimit: 1 });
    const order = await placeOrder(billing);
    const body = await returnBody(order, billing.provider.pay(order.linkId));
    expect((await billing.post('/v1/orders/confirm', body)).status).toBe(200);
    expect((await billing.post('/v1/orders/confirm', body)).status).toBe(429);
  });
});
