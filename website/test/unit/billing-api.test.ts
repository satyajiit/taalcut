// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import {
  type BillingFailure,
  type FailureKind,
  isPayUrl,
  parseCheckout,
  parseConfirmation,
  parseFailure,
  parseQuote,
} from '#lib/billing/api';
import { BILLING_TIMEOUT_MS, createBillingClient } from '#lib/billing/client';

/** The billing service's answers, as its API (version 1) writes them. */
const LIST = {
  plan: 'premium',
  currency: 'USD',
  amount: 40000,
  listAmount: 40000,
  offer: null,
  selling: true,
  currencies: ['USD', 'INR'],
};
const LAUNCH = { ...LIST, amount: 33900, offer: { id: 'product-hunt', endsAt: '2026-11-26T08:01:00.000Z' } };
const ORDER_ID = '01KA7Q3ZV5R8N2M4X6C9D1E3F5';
const CHECKOUT = {
  orderId: ORDER_ID,
  payUrl: 'https://pay.example/l/abc123',
  currency: 'USD',
  amount: 33900,
};
const PAID = {
  orderId: ORDER_ID,
  status: 'paid',
  plan: 'premium',
  currency: 'USD',
  amount: 33900,
  paidAt: '2026-11-19T09:00:00.000Z',
  activateBy: '2026-11-26T09:00:00.000Z',
};
const RETURN = {
  orderId: ORDER_ID,
  linkId: 'plink_Abc123',
  paymentId: 'pay_Abc123',
  status: 'paid',
  signature: 'a'.repeat(64),
};
const ORDER = {
  plan: 'premium',
  name: 'Asha',
  email: 'asha@example.com',
  whatsapp: '+14155550100',
  agreed: true as const,
  currency: 'USD',
  expect: 33900,
};

describe('the billing answers’ shapes', () => {
  it('reads a quote at the list price and one with a launch price', () => {
    expect(parseQuote(LIST)).toEqual(LIST);
    expect(parseQuote(LAUNCH)).toEqual(LAUNCH);
    expect(parseQuote({ ...LIST, selling: false })?.selling).toBe(false);
    // What the page doesn't use is dropped, never passed on.
    expect(parseQuote({ ...LIST, note: 'x' })).toEqual(LIST);
  });

  it('refuses anything that isn’t a quote', () => {
    const bad: unknown[] = [
      null,
      undefined,
      'premium',
      [],
      {},
      { ...LIST, amount: '40000' },
      { ...LIST, amount: 0 },
      { ...LIST, amount: -1 },
      { ...LIST, amount: 399.5 },
      { ...LIST, amount: 50000 },
      { ...LIST, listAmount: undefined },
      { ...LIST, currency: 'usd' },
      { ...LIST, currency: 'DOLLARS' },
      { ...LIST, plan: '' },
      { ...LIST, selling: 'yes' },
      { ...LIST, selling: undefined },
      { ...LIST, offer: undefined },
      { ...LIST, offer: 'product-hunt' },
      { ...LAUNCH, offer: { id: 'product-hunt' } },
      { ...LAUNCH, offer: { id: '', endsAt: '2026-11-26T08:01:00.000Z' } },
      { ...LAUNCH, offer: { id: 'product-hunt', endsAt: 'next week' } },
      // A lower price that names no offer: the page couldn't say what it is, so it is no quote.
      { ...LIST, amount: 33900 },
    ];
    for (const value of bad) expect(parseQuote(value), JSON.stringify(value)).toBeNull();
  });

  it('takes a payment page only at an https address', () => {
    expect(parseCheckout(CHECKOUT)).toEqual(CHECKOUT);
    for (const payUrl of [
      'http://pay.example/l/abc',
      'javascript:alert(1)',
      '/premium/thanks/',
      'pay.example/l/abc',
      '',
      7,
      null,
    ]) {
      expect(isPayUrl(payUrl), String(payUrl)).toBe(false);
      expect(parseCheckout({ ...CHECKOUT, payUrl }), String(payUrl)).toBeNull();
    }
    expect(parseCheckout({ ...CHECKOUT, orderId: '' })).toBeNull();
    expect(parseCheckout({ ...CHECKOUT, amount: '33900' })).toBeNull();
    expect(parseCheckout({ ...CHECKOUT, currency: null })).toBeNull();
    expect(parseCheckout(null)).toBeNull();
  });

  it('reads each state of an order, and nothing else as one', () => {
    expect(parseConfirmation(PAID)).toEqual(PAID);
    for (const status of ['pending', 'expired', 'cancelled']) {
      const unpaid = { ...PAID, status, paidAt: null, activateBy: null };
      expect(parseConfirmation(unpaid)).toEqual(unpaid);
    }
    for (const value of [
      { ...PAID, status: 'refunded' },
      { ...PAID, status: undefined },
      { ...PAID, paidAt: 'yesterday' },
      { ...PAID, paidAt: undefined },
      { ...PAID, activateBy: 1764147600000 },
      { ...PAID, amount: 0 },
      { ...PAID, orderId: 12 },
      { ...PAID, plan: undefined },
      'paid',
      null,
    ]) {
      expect(parseConfirmation(value), JSON.stringify(value)).toBeNull();
    }
    // The page shows no personal data: a name sent by mistake never reaches it.
    expect(parseConfirmation({ ...PAID, name: 'Asha', email: 'asha@example.com' })).toEqual(PAID);
  });

  it('names each refusal by its code', () => {
    const codes: Record<string, FailureKind> = {
      'billing.invalid': 'invalid',
      'billing.not_found': 'not-found',
      'billing.price_changed': 'price-changed',
      'billing.rate_limited': 'rate-limited',
      'billing.busy': 'busy',
      'billing.provider_unavailable': 'provider-unavailable',
      'billing.not_selling': 'not-selling',
      'billing.forbidden': 'forbidden',
    };
    for (const [code, kind] of Object.entries(codes)) {
      const body = code === 'billing.price_changed' ? { code, quote: LIST } : { code };
      expect(parseFailure(body).kind, code).toBe(kind);
    }
    expect(new Set(Object.values(codes)).size).toBe(8);
  });

  it('keeps what a refusal carries, and only when it is well formed', () => {
    expect(
      parseFailure({
        code: 'billing.invalid',
        problems: [{ path: 'email', rule: 'format' }, { path: 7 }, 'x'],
      }),
    ).toEqual({
      kind: 'invalid',
      problems: [{ path: 'email', rule: 'format' }],
    });
    expect(parseFailure({ code: 'billing.invalid' })).toEqual({ kind: 'invalid', problems: [] });
    expect(parseFailure({ code: 'billing.rate_limited', retryAfterSeconds: 41.2 })).toEqual({
      kind: 'rate-limited',
      retryAfterSeconds: 42,
    });
    expect(parseFailure({ code: 'billing.rate_limited', retryAfterSeconds: 'soon' })).toEqual({
      kind: 'rate-limited',
    });
    expect(parseFailure({ code: 'billing.price_changed', quote: LAUNCH })).toEqual({
      kind: 'price-changed',
      quote: LAUNCH,
    });
  });

  it('calls a refusal it doesn’t know unexpected, and a changed price without its new price too', () => {
    for (const body of [
      null,
      undefined,
      '<html>502</html>',
      [],
      {},
      { code: 7 },
      { code: 'billing.teapot' },
      { error: 'no' },
    ]) {
      expect(parseFailure(body), JSON.stringify(body)).toEqual({ kind: 'unexpected' });
    }
    expect(parseFailure({ code: 'billing.price_changed' })).toEqual({ kind: 'unexpected' });
    expect(parseFailure({ code: 'billing.price_changed', quote: { ...LIST, amount: 'free' } })).toEqual({
      kind: 'unexpected',
    });
  });
});

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** A fetch that answers from a script and remembers what it was asked. */
function fakeFetch(answer: (call: Call) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fake = ((input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return Promise.resolve().then(() => answer(call));
  }) as typeof fetch;
  return { fetch: fake, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failureOf = async <T>(
  result: Promise<{ ok: true; value: T } | { ok: false; failure: BillingFailure }>,
) => {
  const settled = await result;
  return settled.ok ? null : settled.failure;
};

describe('the billing client', () => {
  it('asks for a quote with the plan, the visit’s tag and a currency, and sends no credentials', async () => {
    const { fetch, calls } = fakeFetch(() => json(LAUNCH));
    const client = createBillingClient({ base: 'https://billing.taalcut.app', fetch });
    expect(await client.quote('premium', 'producthunt')).toEqual({ ok: true, value: LAUNCH });
    expect(await client.quote('premium', null)).toEqual({ ok: true, value: LAUNCH });
    expect(calls.map((c) => c.url)).toEqual([
      'https://billing.taalcut.app/v1/quote?plan=premium&ref=producthunt&currency=auto',
      'https://billing.taalcut.app/v1/quote?plan=premium&currency=auto',
    ]);
    for (const call of calls) {
      expect(call.init.method).toBe('GET');
      expect(call.init.credentials).toBe('omit');
      expect(call.init.body).toBeUndefined();
      // No header that would make the browser ask permission first: a quote is a plain GET.
      expect(Object.keys(call.init.headers ?? {})).toEqual(['accept']);
    }
  });

  it('posts an order and a return’s values as JSON, exactly as given', async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.url.endsWith('/v1/checkout') ? json(CHECKOUT, 201) : json(PAID),
    );
    const client = createBillingClient({ base: '/__billing', fetch });
    expect(await client.checkout({ ...ORDER, ref: 'producthunt' })).toEqual({
      ok: true,
      value: CHECKOUT,
    });
    expect(await client.confirm(RETURN)).toEqual({ ok: true, value: PAID });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['POST', '/__billing/v1/checkout'],
      ['POST', '/__billing/v1/orders/confirm'],
    ]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ...ORDER, ref: 'producthunt' });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual(RETURN);
    for (const call of calls) expect(call.init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('turns each refusal into its cause', async () => {
    const refusals: [number, unknown, BillingFailure][] = [
      [
        400,
        { code: 'billing.invalid', problems: [{ path: 'whatsapp', rule: 'required' }] },
        { kind: 'invalid', problems: [{ path: 'whatsapp', rule: 'required' }] },
      ],
      [404, { code: 'billing.not_found' }, { kind: 'not-found' }],
      [409, { code: 'billing.price_changed', quote: LIST }, { kind: 'price-changed', quote: LIST }],
      [
        429,
        { code: 'billing.rate_limited', retryAfterSeconds: 30 },
        { kind: 'rate-limited', retryAfterSeconds: 30 },
      ],
      [500, { code: 'billing.busy' }, { kind: 'busy' }],
      [502, { code: 'billing.provider_unavailable' }, { kind: 'provider-unavailable' }],
      [503, { code: 'billing.not_selling' }, { kind: 'not-selling' }],
      // A page that isn't the website's: the service refuses it whatever it sends.
      [403, { code: 'billing.forbidden' }, { kind: 'forbidden' }],
      // A wait can be a caller's daily allowance: hours, kept as the service gave it.
      [
        429,
        { code: 'billing.rate_limited', retryAfterSeconds: 18000 },
        { kind: 'rate-limited', retryAfterSeconds: 18000 },
      ],
    ];
    for (const [status, body, failure] of refusals) {
      const client = createBillingClient({ base: '', fetch: fakeFetch(() => json(body, status)).fetch });
      expect(await failureOf(client.checkout(ORDER)), String(status)).toEqual(failure);
    }
  });

  it('calls an answer of the wrong shape unexpected, whatever its status', async () => {
    const answers: Response[] = [
      new Response('<html>Bad gateway</html>', { status: 502 }),
      new Response('not json', { status: 200 }),
      json({ ok: true }),
      json({ ...CHECKOUT, payUrl: 'http://example.com/pay' }, 201),
      json([], 201),
      new Response(null, { status: 204 }),
    ];
    for (const answer of answers) {
      const client = createBillingClient({ base: '', fetch: fakeFetch(() => answer).fetch });
      expect(await failureOf(client.checkout(ORDER)), String(answer.status)).toEqual({ kind: 'unexpected' });
    }
  });

  it('never takes a quote for another plan or an answer about another order', async () => {
    const other = createBillingClient({
      base: '',
      fetch: fakeFetch(() => json({ ...LIST, plan: 'studio' })).fetch,
    });
    expect(await failureOf(other.quote('premium', null))).toEqual({ kind: 'unexpected' });
    const swapped = createBillingClient({
      base: '',
      fetch: fakeFetch(() => json({ ...PAID, orderId: '01KA7Q3ZV5R8N2M4X6C9D1E3F6' })).fetch,
    });
    expect(await failureOf(swapped.confirm(RETURN))).toEqual({ kind: 'unexpected' });
  });

  it('tells a dropped connection from a service out of reach, and a slow one from both', async () => {
    const refused = () => Promise.reject(new TypeError('Failed to fetch'));
    const offline = createBillingClient({ base: '', fetch: fakeFetch(refused).fetch, online: () => false });
    expect(await failureOf(offline.quote('premium', null))).toEqual({ kind: 'offline' });
    const unreachable = createBillingClient({
      base: '',
      fetch: fakeFetch(refused).fetch,
      online: () => true,
    });
    expect(await failureOf(unreachable.quote('premium', null))).toEqual({ kind: 'unreachable' });

    // A service that never answers: the call ends by itself, and says so.
    const hangs = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })) as typeof fetch;
    const slow = createBillingClient({ base: '', fetch: hangs, timeoutMs: 20, online: () => true });
    expect(await failureOf(slow.quote('premium', null))).toEqual({ kind: 'timeout' });
    expect(BILLING_TIMEOUT_MS).toBeGreaterThanOrEqual(8000);
  });

  it('never throws, whatever the transport does', async () => {
    const throws = (() => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const client = createBillingClient({ base: '', fetch: throws, online: () => true });
    expect(await failureOf(client.confirm(RETURN))).toEqual({ kind: 'unreachable' });
  });
});
