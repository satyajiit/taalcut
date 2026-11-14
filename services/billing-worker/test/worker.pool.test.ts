// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import migration from '../migrations/0001_init.sql?raw';
import worker, { createBillingWorker } from '../src/index';
import { createNotifier } from '../src/notify/notifier';
import { hmacHex, returnMessage } from '../src/razorpay/signature';
import { type Order } from '../src/store/d1-orders';
import { FakeProvider } from './fake-provider';

async function applyMigration(): Promise<void> {
  const statements = migration
    .split(';')
    .map((part) => part.replace(/--[^\n]*/g, '').trim())
    .filter((part) => part.length > 0);
  for (const statement of statements) await env.ORDERS.prepare(statement).run();
}

const ctx = { waitUntil: (work: Promise<unknown>) => void work };

describe('worker pool', () => {
  it('boots the deployed configuration in workerd: prices, checks, limits and signatures on Miniflare D1', async () => {
    await applyMigration();
    const count = z
      .object({ n: z.number() })
      .parse(await env.ORDERS.prepare('SELECT COUNT(*) AS n FROM orders').first());
    expect(count.n).toBe(0);

    const health = await worker.fetch(new Request('https://billing.taalcut.app/v1/health'), env, ctx);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, selling: true });

    // wrangler.jsonc's own catalogue, read by the Worker inside workerd.
    const quote = await worker.fetch(
      new Request('https://billing.taalcut.app/v1/quote?plan=premium', {
        headers: { origin: 'https://taalcut.app' },
      }),
      env,
      ctx,
    );
    expect(quote.status).toBe(200);
    expect(quote.headers.get('access-control-allow-origin')).toBe('https://taalcut.app');
    expect(z.object({ listAmount: z.number(), currency: z.string() }).parse(await quote.json())).toEqual({
      listAmount: 40000,
      currency: 'USD',
    });

    const json = { 'content-type': 'application/json' };
    const oversized = await worker.fetch(
      new Request('https://billing.taalcut.app/v1/checkout', {
        method: 'POST',
        headers: json,
        body: new Uint8Array(64 * 1024 + 1),
      }),
      env,
      ctx,
    );
    expect(oversized.status).toBe(413);

    const invalid = await worker.fetch(
      new Request('https://billing.taalcut.app/v1/checkout', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ plan: 'premium' }),
      }),
      env,
      ctx,
    );
    expect(invalid.status).toBe(400);
    expect(z.object({ code: z.string() }).parse(await invalid.json()).code).toBe('billing.invalid');

    // WebCrypto's HMAC verify in workerd: an unsigned delivery is refused.
    const unsigned = await worker.fetch(
      new Request('https://billing.taalcut.app/v1/razorpay/webhook', {
        method: 'POST',
        headers: { 'x-razorpay-signature': 'a'.repeat(64) },
        body: '{}',
      }),
      env,
      ctx,
    );
    expect(unsigned.status).toBe(401);

    const take =
      'INSERT INTO day_counts (key, day, n) VALUES (?, ?, 1) ON CONFLICT (key, day) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n';
    const taken = [];
    for (let index = 0; index < 3; index += 1)
      taken.push(await env.ORDERS.prepare(take).bind('k', 'd', 2).first());
    expect(taken).toEqual([{ n: 1 }, { n: 2 }, null]);

    // The sweep runs against D1 with nothing to do.
    await worker.scheduled({}, env, ctx);
  });

  it('takes an order, settles it and tells people, with every statement run on Miniflare D1', async () => {
    const provider = new FakeProvider(() => Date.now());
    const billing = createBillingWorker({
      provider: () => provider,
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
    });
    const pending: Promise<unknown>[] = [];
    const lifetime = { waitUntil: (work: Promise<unknown>) => void pending.push(work) };
    const post = (path: string, body: unknown): Promise<Response> =>
      billing.fetch(
        new Request(`https://billing.taalcut.app${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://taalcut.app',
            'cf-connecting-ip': '203.0.113.7',
          },
          body: JSON.stringify(body),
        }),
        env,
        lifetime,
      );

    const made = await post('/v1/checkout', {
      plan: 'premium',
      name: 'Asha Rao',
      email: 'asha@example.com',
      whatsapp: '+14155550100',
      agreed: true,
    });
    expect(made.status).toBe(201);
    const order = z
      .object({ orderId: z.string(), payUrl: z.string(), amount: z.number() })
      .parse(await made.json());
    const linkId = order.payUrl.slice(order.payUrl.lastIndexOf('/') + 1);
    const paymentId = provider.pay(linkId);

    const values = { orderId: order.orderId, linkId, paymentId, status: 'paid' };
    const signature = await hmacHex('pool-test-key-secret-not-a-secret', returnMessage(values));
    const confirmed = await post('/v1/orders/confirm', { ...values, signature });
    expect(confirmed.status).toBe(200);
    expect(z.object({ status: z.string() }).parse(await confirmed.json()).status).toBe('paid');
    await Promise.all(pending);

    const row = z
      .object({
        status: z.string(),
        payment_id: z.string(),
        amount: z.number(),
        owner_notified_at: z.number(),
        buyer_notified_at: z.number(),
      })
      .parse(await env.ORDERS.prepare('SELECT * FROM orders WHERE id = ?').bind(order.orderId).first());
    expect(row).toMatchObject({ status: 'paid', payment_id: paymentId, amount: order.amount });
    // One unit of this caller's day and one of everyone's.
    const units = z
      .object({ n: z.number() })
      .parse(
        await env.ORDERS.prepare("SELECT COUNT(*) AS n FROM day_counts WHERE key LIKE 'checkout:%'").first(),
      );
    expect(units.n).toBe(2);
    // The sweep's own statements, with a paid order in the table.
    await billing.scheduled({}, env, lifetime);
  });

  it('hands both messages to the email binding in the shape it takes', async () => {
    const order: Order = {
      id: '01KA0000000000000000000001',
      mode: 'test',
      plan: 'premium',
      currency: 'USD',
      amount: 33900,
      listAmount: 40000,
      offerId: 'product-hunt',
      status: 'paid',
      name: 'Asha Rao',
      email: 'asha@example.com',
      whatsapp: null,
      channel: null,
      country: 'US',
      linkId: 'plink_Test000001',
      paymentId: 'pay_Test0000010001',
      createdAt: 1_794_441_600_000,
      expiresAt: 1_794_528_000_000,
      paidAt: 1_794_441_700_000,
      ownerNotifiedAt: null,
      buyerNotifiedAt: null,
    };
    const notifier = createNotifier({
      email: env.EMAIL,
      mail: { ownerEmail: 'owner@example.com', from: 'premium@taalcut.app' },
      webhookUrl: null,
      fetch: () => Promise.reject(new Error('no network in the pool test')),
      planLabel: () => 'Taalcut Premium',
    });
    expect(env.EMAIL).toBeDefined();
    expect(await notifier.owner(order)).toBe('sent');
    expect(await notifier.buyer(order)).toBe('sent');
  });
});
