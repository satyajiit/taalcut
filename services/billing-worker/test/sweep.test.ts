// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';

import { createTestBilling, placeOrder, returnBody } from './harness';

const MINUTE = 60_000;
const DAY = 86_400_000;

describe('the scheduled sweep', () => {
  it('makes an order paid with no return and no delivery at all', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    billing.provider.pay(order.linkId);

    // Too young: the buyer may still be on their way back.
    billing.clock.now += MINUTE;
    await billing.sweep();
    expect(billing.provider.reads).toBe(0);

    billing.clock.now += 2 * MINUTE;
    await billing.sweep();
    await billing.settled();
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ status: 'paid' })]);
    expect(billing.emails.map((email) => email.to)).toEqual(['owner@example.com', 'asha@example.com']);

    // A paid order is left alone.
    const reads = billing.provider.reads;
    billing.clock.now += 5 * MINUTE;
    await billing.sweep();
    await billing.settled();
    expect(billing.provider.reads).toBe(reads);
    expect(billing.emails).toHaveLength(2);
  });

  it('closes orders whose link ran out and keeps looking at the ones still open', async () => {
    const billing = createTestBilling();
    const expired = await placeOrder(billing);
    const open = await placeOrder(billing, { email: 'open@example.com' });
    billing.provider.close(expired.linkId, 'expired');
    billing.clock.now += 3 * MINUTE;
    await billing.sweep();
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ id: expired.orderId, status: 'expired' }),
      expect.objectContaining({ id: open.orderId, status: 'created', checked_at: billing.clock.now }),
    ]);
  });

  it('stops asking for this run when the provider is away', async () => {
    const billing = createTestBilling();
    await placeOrder(billing);
    await placeOrder(billing, { email: 'two@example.com' });
    billing.provider.away = true;
    billing.clock.now += 3 * MINUTE;
    await billing.sweep();
    expect(billing.provider.reads).toBe(1);
  });

  it('tells us again when the first telling did not go out', async () => {
    const billing = createTestBilling({ noEmail: true, chatFails: true });
    const order = await placeOrder(billing);
    await billing.post('/v1/orders/confirm', await returnBody(order, billing.provider.pay(order.linkId)));
    await billing.settled();
    expect(billing.chats).toHaveLength(1);
    expect(billing.db.snapshot()['orders']).toEqual([
      // With no email channel the buyer is not owed a retry; we still are.
      expect.objectContaining({
        status: 'paid',
        owner_notified_at: null,
        buyer_notified_at: billing.clock.now,
      }),
    ]);

    billing.clock.now += 5 * MINUTE;
    await billing.sweep();
    expect(billing.chats).toHaveLength(2);
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ owner_notified_at: null })]);
  });

  it('retries the buyer’s email when the mailbox failed, and stops once it is sent', async () => {
    const billing = createTestBilling({ emailFails: true });
    const order = await placeOrder(billing);
    await billing.post('/v1/orders/confirm', await returnBody(order, billing.provider.pay(order.linkId)));
    await billing.settled();
    // The chat webhook still told us.
    expect(billing.emails).toEqual([]);
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ owner_notified_at: billing.clock.now, buyer_notified_at: null }),
    ]);

    // Still down: nothing is recorded as sent.
    billing.clock.now += 5 * MINUTE;
    await billing.sweep();
    expect(billing.db.snapshot()['orders']).toEqual([expect.objectContaining({ buyer_notified_at: null })]);

    billing.mail.fails = false;
    billing.clock.now += 5 * MINUTE;
    await billing.sweep();
    expect(billing.emails.map((email) => email.to)).toEqual(['asha@example.com']);
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ buyer_notified_at: billing.clock.now }),
    ]);
    // We were told once, by chat, and are not told again; the buyer is not told again either.
    billing.clock.now += 5 * MINUTE;
    await billing.sweep();
    expect(billing.emails).toHaveLength(1);
    expect(billing.chats).toHaveLength(1);
  });

  it('is not held up by an order whose link the provider cannot show', async () => {
    const billing = createTestBilling();
    const lost = await placeOrder(billing);
    const paid = await placeOrder(billing, { email: 'paid@example.com' });
    billing.provider.forget(lost.linkId);
    billing.provider.pay(paid.linkId);
    billing.clock.now += 3 * MINUTE;
    await billing.sweep();
    await billing.settled();
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ id: lost.orderId, status: 'created', checked_at: billing.clock.now }),
      expect.objectContaining({ id: paid.orderId, status: 'paid' }),
    ]);

    // And when the provider is away, the order that was tried goes to the back of the line.
    const away = createTestBilling();
    const first = await placeOrder(away);
    const second = await placeOrder(away, { email: 'second@example.com' });
    away.provider.away = true;
    away.clock.now += 3 * MINUTE;
    await away.sweep();
    away.provider.away = false;
    away.provider.pay(second.linkId);
    away.clock.now += 5 * MINUTE;
    await away.sweep();
    expect(away.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ id: first.orderId, status: 'created' }),
      expect.objectContaining({ id: second.orderId, status: 'paid' }),
    ]);
  });

  it('stops starting work two minutes into a run, so the next run never overlaps it', async () => {
    const billing = createTestBilling();
    for (let index = 0; index < 8; index += 1)
      await placeOrder(billing, { email: `buyer${index}@example.com` });
    // Every read of a link takes thirty seconds.
    const read = billing.provider.getLink.bind(billing.provider);
    billing.provider.getLink = (id) => {
      billing.clock.now += 30_000;
      return read(id);
    };
    billing.clock.now += 3 * MINUTE;
    await billing.sweep();
    expect(billing.provider.reads).toBe(5);
    // The rest are first in line next time.
    await billing.sweep();
    expect(billing.provider.reads).toBe(10);
  });

  it('gives up on an order whose link was never made, and deletes orders never paid after four weeks', async () => {
    const billing = createTestBilling();
    const paid = await placeOrder(billing);
    await billing.post('/v1/orders/confirm', await returnBody(paid, billing.provider.pay(paid.linkId)));
    const abandoned = await placeOrder(billing, { email: 'gone@example.com' });
    billing.provider.close(abandoned.linkId, 'expired');
    await billing.db
      .prepare(
        `INSERT INTO orders (id, mode, plan, currency, amount, list_amount, status, name, email, created_at, expires_at)
         VALUES ('01KA0000000000000000000001', 'live', 'premium', 'USD', 40000, 40000, 'created', 'No Link', 'n@example.com', ?, ?)`,
      )
      .bind(billing.clock.now, billing.clock.now + DAY)
      .run();

    billing.clock.now += 11 * MINUTE;
    await billing.sweep();
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ id: paid.orderId, status: 'paid' }),
      expect.objectContaining({ id: abandoned.orderId, status: 'expired' }),
      expect.objectContaining({ id: '01KA0000000000000000000001', status: 'failed' }),
    ]);

    billing.clock.now += 28 * DAY;
    await billing.sweep();
    // The paid order stays; the two that were never paid are gone, with the names typed into them.
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ id: paid.orderId, status: 'paid' }),
    ]);
  });

  it('does nothing without a readable configuration', async () => {
    const billing = createTestBilling({ env: { CATALOG: 'not json' } });
    await billing.sweep();
    expect(billing.provider.reads).toBe(0);
  });
});
