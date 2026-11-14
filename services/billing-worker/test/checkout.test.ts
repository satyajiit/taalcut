// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CHECKOUTS_PER_DAY } from '../src/limits/rate-limits';
import { BUYER, createTestBilling, LAUNCH_DAY, LAUNCH_WEEK, placeOrder, SITE } from './harness';

const refusal = z.object({
  code: z.string(),
  problems: z.array(z.object({ path: z.string(), rule: z.string() })).optional(),
});

async function problemsOf(response: Response): Promise<string[]> {
  const body = refusal.parse(await response.json());
  expect(body.code).toBe('billing.invalid');
  return (body.problems ?? []).map((problem) => `${problem.path}:${problem.rule}`).sort();
}

describe('checkout', () => {
  it('writes the order down, makes its link at the list price and answers with the payment page', async () => {
    const billing = createTestBilling();
    const response = await billing.post('/v1/checkout', { ...BUYER, expect: 40000 });
    expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = z
      .object({ orderId: z.string(), payUrl: z.string(), currency: z.string(), amount: z.number() })
      .strict()
      .parse(await response.json());
    expect(body).toMatchObject({ currency: 'USD', amount: 40000 });
    expect(body.orderId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(body.payUrl).toMatch(/^https:\/\/rzp\.io\/i\/plink_/);

    expect(billing.provider.created).toEqual([
      {
        amount: 40000,
        currency: 'USD',
        referenceId: body.orderId,
        description: 'Taalcut Premium: one month',
        // The phone number and the channel stay with us: the payment page needs neither.
        customer: { name: 'Asha Rao', email: 'asha@example.com', contact: '+14155550100' },
        returnUrl: 'https://taalcut.app/premium/thanks/',
        expireBy: Math.floor((billing.clock.now + 24 * 60 * 60 * 1000) / 1000),
        notes: { taalcut_order: body.orderId, taalcut_plan: 'premium', taalcut_offer: 'none' },
      },
    ]);
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({
        id: body.orderId,
        mode: 'live',
        plan: 'premium',
        currency: 'USD',
        amount: 40000,
        list_amount: 40000,
        offer_id: null,
        status: 'created',
        name: 'Asha Rao',
        email: 'asha@example.com',
        whatsapp: '+14155550100',
        channel: 'https://www.instagram.com/asha.makes/',
        link_id: body.payUrl.slice(body.payUrl.lastIndexOf('/') + 1),
        paid_at: null,
      }),
    ]);
    // Nobody is told about an order that is not paid.
    await billing.settled();
    expect(billing.emails).toEqual([]);
    expect(billing.chats).toEqual([]);
  });

  it('charges the price the server decides, never one the page sends', async () => {
    const billing = createTestBilling({ now: LAUNCH_WEEK });
    // The page claims the launch price without the visitor having arrived from Product Hunt.
    const cheap = await billing.post('/v1/checkout', { ...BUYER, expect: 33900 });
    expect(cheap.status).toBe(409);
    expect(await cheap.json()).toEqual({
      code: 'billing.price_changed',
      quote: {
        plan: 'premium',
        currency: 'USD',
        amount: 40000,
        listAmount: 40000,
        offer: null,
        selling: true,
      },
    });
    expect(billing.provider.created).toEqual([]);
    expect(billing.db.snapshot()['orders']).toEqual([]);

    // An amount field is not part of the form at all.
    const smuggled = await billing.post('/v1/checkout', { ...BUYER, amount: 100 });
    expect(await problemsOf(smuggled)).toEqual(['amount:unknown']);

    const honest = await placeOrder(billing, { ref: 'producthunt', expect: 33900 });
    expect(honest.amount).toBe(33900);
    expect(billing.provider.created.at(-1)).toMatchObject({
      amount: 33900,
      notes: { taalcut_offer: 'product-hunt' },
    });
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ amount: 33900, list_amount: 40000, offer_id: 'product-hunt' }),
    ]);
  });

  it('tells the page when an offer ended between showing the price and the order', async () => {
    const billing = createTestBilling({ now: LAUNCH_DAY });
    billing.clock.now = Date.parse('2026-11-20T08:01:00Z');
    const late = await billing.post('/v1/checkout', { ...BUYER, expect: 33900 });
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ code: 'billing.price_changed', quote: { amount: 40000 } });
  });

  it('names each thing wrong with the form', async () => {
    const billing = createTestBilling();
    expect(await problemsOf(await billing.post('/v1/checkout', {}))).toEqual([
      'agreed:required',
      'email:required',
      'name:required',
      'plan:required',
      'whatsapp:required',
    ]);
    const bad = {
      plan: 'premium',
      name: 'A',
      email: 'asha@example',
      whatsapp: '4155550100',
      channel: 'instagram asha',
      agreed: 'yes',
      expect: -1,
      ref: 7,
    };
    expect(await problemsOf(await billing.post('/v1/checkout', bad))).toEqual([
      'agreed:required',
      'channel:format',
      'email:format',
      'expect:format',
      'name:tooShort',
      'ref:format',
      'whatsapp:format',
    ]);
    expect(await problemsOf(await billing.post('/v1/checkout', { ...BUYER, name: 'x'.repeat(81) }))).toEqual([
      'name:tooLong',
    ]);
    expect(await problemsOf(await billing.post('/v1/checkout', { ...BUYER, name: 'Asha‮oaR' }))).toEqual([
      'name:format',
    ]);
    expect(await problemsOf(await billing.post('/v1/checkout', { ...BUYER, plan: 'gold' }))).toEqual([
      'plan:unknown',
    ]);
    expect(await problemsOf(await billing.post('/v1/checkout', [BUYER]))).toEqual([':schema']);
    expect(billing.provider.created).toEqual([]);
  });

  it('takes an order with no channel or a channel given as a handle, and none without a phone number', async () => {
    const billing = createTestBilling();
    await placeOrder(billing, { channel: undefined });
    await placeOrder(billing, { channel: '@asha.makes' });
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ whatsapp: '+14155550100', channel: null }),
      expect.objectContaining({ whatsapp: '+14155550100', channel: '@asha.makes' }),
    ]);
    // The provider makes no payment page without a phone number, so the form may not leave it out.
    for (const whatsapp of ['', '   ', undefined, null]) {
      const response = await billing.post('/v1/checkout', { ...BUYER, whatsapp });
      expect(response.status).toBe(400);
      expect(await problemsOf(response)).toEqual(['whatsapp:required']);
    }
    expect(billing.provider.created).toHaveLength(2);
  });

  it('refuses a body that is too large, not sent as JSON or not JSON, before reading it', async () => {
    const billing = createTestBilling();
    const json = { 'content-type': 'application/json' };
    const large = await billing.request('/v1/checkout', {
      method: 'POST',
      headers: json,
      body: new Uint8Array(64 * 1024 + 1),
    });
    expect(large.status).toBe(413);
    const broken = await billing.request('/v1/checkout', { method: 'POST', headers: json, body: '{"plan":' });
    expect(broken.status).toBe(400);
    expect(await problemsOf(broken)).toEqual([':schema']);
    // A form post or a text/plain request is what another site's page can send without asking first.
    for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded']) {
      const response = await billing.request('/v1/checkout', {
        method: 'POST',
        ...(type === undefined ? {} : { headers: { 'content-type': type } }),
        body: JSON.stringify(BUYER),
      });
      expect(response.status).toBe(415);
    }
    expect(billing.provider.created).toEqual([]);
  });

  it('takes no order while it is not selling', async () => {
    for (const env of [{ SELLING: 'off' }, { RAZORPAY_KEY_ID: undefined }, { MODE: 'test' }]) {
      const billing = createTestBilling({ env });
      const response = await billing.post('/v1/checkout', BUYER);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: 'billing.not_selling' });
      expect(billing.db.snapshot()['orders']).toEqual([]);
    }
  });

  it('closes the order when the payment provider makes no link', async () => {
    const billing = createTestBilling();
    billing.provider.away = true;
    const response = await billing.post('/v1/checkout', BUYER);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'billing.provider_unavailable' });
    expect(billing.db.snapshot()['orders']).toEqual([
      expect.objectContaining({ status: 'failed', link_id: null }),
    ]);
  });

  it('limits one caller by the minute and everyone by the day', async () => {
    const burst = createTestBilling({ checkoutLimit: 2 });
    const headers = { 'cf-connecting-ip': '203.0.113.7' };
    expect((await burst.post('/v1/checkout', BUYER, headers)).status).toBe(201);
    expect((await burst.post('/v1/checkout', BUYER, headers)).status).toBe(201);
    const third = await burst.post('/v1/checkout', BUYER, headers);
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({ code: 'billing.rate_limited', retryAfterSeconds: 60 });
    // A form with a typo spends nothing.
    expect(
      (await burst.post('/v1/checkout', { ...BUYER, email: 'no' }, { 'cf-connecting-ip': '203.0.113.8' }))
        .status,
    ).toBe(400);
    expect((await burst.post('/v1/checkout', BUYER, { 'cf-connecting-ip': '203.0.113.8' })).status).toBe(201);

    const day = createTestBilling({ checkoutLimit: 100_000 });
    await day.db
      .prepare('INSERT INTO day_counts (key, day, n) VALUES (?, ?, ?)')
      .bind('checkout:*', '2026-11-18', CHECKOUTS_PER_DAY)
      .run();
    const over = await day.post('/v1/checkout', BUYER);
    expect(over.status).toBe(429);
    expect(day.provider.created).toEqual([]);
  });

  it('lets only the website read its answers', async () => {
    const billing = createTestBilling();
    // A page on another site may not place an order at all, and is told nothing it can read.
    const other = await billing.post('/v1/checkout', BUYER, { origin: 'https://example.com' });
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({ code: 'billing.forbidden' });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    expect(billing.provider.created).toEqual([]);
    // A caller that is not a browser names no page.
    const plain = await billing.request('/v1/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BUYER),
    });
    expect(plain.status).toBe(201);

    const preflight = await billing.request('/v1/checkout', {
      method: 'OPTIONS',
      headers: { origin: SITE, 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(preflight.headers.get('access-control-allow-headers')).toBe('content-type');
    const stranger = await billing.request('/v1/checkout', {
      method: 'OPTIONS',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' },
    });
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull();

    const missing = await billing.request('/v1/nothing');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ code: 'billing.not_found' });
    expect((await billing.request('/v1/checkout')).status).toBe(404);
  });
});
