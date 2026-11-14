// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { readCatalog } from '../src/config/catalog';
import { callerKey, CHECKOUTS_PER_CALLER_PER_DAY } from '../src/limits/rate-limits';
import { BUYER, CATALOG, createTestBilling, placeOrder, returnBody, TEST_KEY_ID } from './harness';

const dayCounts = z.array(z.object({ key: z.string(), day: z.string(), n: z.number() }));

function counts(billing: ReturnType<typeof createTestBilling>): z.infer<typeof dayCounts> {
  return dayCounts.parse(billing.db.snapshot()['day_counts']);
}

describe('what one caller can use up', () => {
  it('is nothing when the order is refused before a link would be made', async () => {
    const billing = createTestBilling();
    expect((await billing.post('/v1/checkout', { ...BUYER, plan: 'gold' })).status).toBe(400);
    expect((await billing.post('/v1/checkout', { ...BUYER, expect: 1 })).status).toBe(409);
    expect((await billing.post('/v1/checkout', { ...BUYER, email: 'nope' })).status).toBe(400);
    expect(counts(billing)).toEqual([]);
    await placeOrder(billing);
    expect(counts(billing).map((row) => row.n)).toEqual([1, 1]);
  });

  it('is their own day’s allowance, never everyone’s', async () => {
    const billing = createTestBilling({ checkoutLimit: 100_000 });
    const one = { 'cf-connecting-ip': '203.0.113.7' };
    for (let index = 0; index < CHECKOUTS_PER_CALLER_PER_DAY; index += 1)
      expect((await billing.post('/v1/checkout', BUYER, one)).status).toBe(201);
    const over = await billing.post('/v1/checkout', BUYER, one);
    expect(over.status).toBe(429);
    expect(billing.provider.created).toHaveLength(CHECKOUTS_PER_CALLER_PER_DAY);
    // Everyone's counter was not touched by the refused order, and another caller still orders.
    expect(counts(billing).find((row) => row.key === 'checkout:*')?.n).toBe(CHECKOUTS_PER_CALLER_PER_DAY);
    expect((await billing.post('/v1/checkout', BUYER, { 'cf-connecting-ip': '203.0.113.8' })).status).toBe(
      201,
    );
    // The next day the caller orders again, and the sweep has deleted the day before's counters.
    billing.clock.now += 86_400_000;
    await billing.sweep();
    expect(counts(billing)).toEqual([]);
    expect((await billing.post('/v1/checkout', BUYER, one)).status).toBe(201);
  });

  it('is counted for a whole IPv6 /64, and under a hash that is not the address', async () => {
    const billing = createTestBilling({ checkoutLimit: 100_000 });
    for (let index = 0; index < CHECKOUTS_PER_CALLER_PER_DAY; index += 1) {
      const address = `2001:db8:12:34:${index.toString(16)}::1`;
      expect((await billing.post('/v1/checkout', BUYER, { 'cf-connecting-ip': address })).status).toBe(201);
    }
    const same = await billing.post('/v1/checkout', BUYER, { 'cf-connecting-ip': '2001:db8:12:34:ffff::9' });
    expect(same.status).toBe(429);
    const other = await billing.post('/v1/checkout', BUYER, { 'cf-connecting-ip': '2001:db8:12:35::1' });
    expect(other.status).toBe(201);
    for (const row of counts(billing)) {
      expect(row.key).toMatch(/^checkout:(\*|[0-9a-f]{32})$/);
      expect(row.key).not.toContain('2001');
    }
  });

  it('names a caller by address for IPv4 and by /64 for IPv6', () => {
    const key = (address: string): string =>
      callerKey(new Request('https://billing.taalcut.app/', { headers: { 'cf-connecting-ip': address } }));
    expect(key('203.0.113.7')).toBe('203.0.113.7');
    expect(key('2001:db8:12:34:5678:9abc:def0:1')).toBe('2001:db8:12:34::/64');
    expect(key('2001:0DB8:0012:0034::1')).toBe('2001:db8:12:34::/64');
    expect(key('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(key('::1')).toBe('0:0:0:0::/64');
    // Not an address this reads: used as it is, never thrown on.
    expect(key('::ffff:203.0.113.7')).toBe('::ffff:203.0.113.7');
    expect(callerKey(new Request('https://billing.taalcut.app/'))).toBe('unknown');
  });
});

describe('what a buyer’s own text can do', () => {
  it('is nothing in an email address: control and direction-changing characters are refused', async () => {
    const billing = createTestBilling();
    for (const email of [
      'a\u0001b@example.com',
      'a\u0000@example.com',
      'a‮b@example.com',
      'a b@example.com',
    ]) {
      const response = await billing.post('/v1/checkout', { ...BUYER, email });
      expect(response.status).toBe(400);
    }
    expect(billing.provider.created).toEqual([]);
  });

  it('is nothing in the chat message: no ping, no link under another label', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing, {
      name: '@everyone <!channel> <https://evil.example|Open order> &',
    });
    await billing.post('/v1/orders/confirm', await returnBody(order, billing.provider.pay(order.linkId)));
    await billing.settled();
    const sent = z
      .object({
        content: z.string(),
        text: z.string(),
        allowed_mentions: z.object({ parse: z.array(z.string()) }),
      })
      .parse(JSON.parse(billing.chats[0] ?? ''));
    expect(sent.allowed_mentions.parse).toEqual([]);
    expect(sent.content).toBe(sent.text);
    expect(sent.content).not.toMatch(/[<>]/);
    // The address in the message is still one that can be copied.
    expect(sent.content).toContain('Email: asha@example.com');
    expect(sent.content).toContain('&lt;https://evil.example|Open order&gt; &amp;');
    // In the email the same text is plain text and escaped HTML.
    const toBuyer = billing.emails.find((email) => email.to === 'asha@example.com');
    expect(toBuyer?.html).toContain('&lt;https://evil.example|Open order&gt; &amp;');
    expect(toBuyer?.html).not.toContain('<https://');
  });
});

describe('the provider’s test mode', () => {
  it('emails no stranger: the buyer’s message goes to us, marked as a test', async () => {
    const billing = createTestBilling({ env: { MODE: 'test', RAZORPAY_KEY_ID: TEST_KEY_ID } });
    const order = await placeOrder(billing, { email: 'stranger@example.net' });
    await billing.post('/v1/orders/confirm', await returnBody(order, billing.provider.pay(order.linkId)));
    await billing.settled();
    expect(billing.emails.map((email) => [email.to, email.subject])).toEqual([
      ['owner@example.com', `Taalcut Premium: paid order ${order.orderId}`],
      ['owner@example.com', '[TEST] Your Taalcut Premium payment is in'],
    ]);
    expect(billing.emails[0]?.text).toContain('TEST MODE, no money moved');
    expect(billing.emails[1]?.text).toContain(
      'TEST MODE: no money moved. This is the message stranger@example.net',
    );
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ mode: 'test', status: 'paid' }),
    ]);
  });

  it('cannot read an order made in live mode, nor the reverse', async () => {
    const billing = createTestBilling();
    const order = await placeOrder(billing);
    const body = await returnBody(order, billing.provider.pay(order.linkId));
    billing.env.MODE = 'test';
    billing.env.RAZORPAY_KEY_ID = TEST_KEY_ID;
    const response = await billing.post('/v1/orders/confirm', body);
    expect(response.status).toBe(502);
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ mode: 'live', status: 'created' }),
    ]);
  });
});

describe('a malformed catalogue', () => {
  const plans = CATALOG.plans;
  const offer = CATALOG.offers[0];

  it('is refused for a time that does not say its zone', () => {
    expect(readCatalog({ plans, offers: [{ ...offer, startsAt: '2026-11-19T08:01:00' }] })).toBeNull();
    expect(readCatalog({ plans, offers: [{ ...offer, startsAt: '1' }] })).toBeNull();
    expect(readCatalog({ plans, offers: [{ ...offer, startsAt: '2026-11-19' }] })).toBeNull();
    expect(
      readCatalog({ plans, offers: [{ ...offer, startsAt: '2026-11-19T13:31:00+05:30' }] })?.offers[0]
        ?.startsAt,
    ).toBe(Date.parse('2026-11-19T08:01:00Z'));
  });

  it('is refused, not thrown on, when an offer names something every object has', async () => {
    for (const plan of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      expect(readCatalog({ plans, offers: [{ ...offer, plan }] })).toBeNull();
    expect(readCatalog({ plans, offers: [{ ...offer, currency: 'toString' }] })).toBeNull();

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const billing = createTestBilling({
      env: { CATALOG: { plans, offers: [{ ...offer, plan: 'constructor' }] } },
    });
    const response = await billing.request('/v1/quote?plan=premium');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'billing.not_selling' });
    logged.mockRestore();
  });
});
