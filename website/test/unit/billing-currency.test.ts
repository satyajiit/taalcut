// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { beforeEach, describe, expect, it } from 'vitest';
import { AUTO_CURRENCY, isCurrencyCode, parseFailure, parseQuote } from '#lib/billing/api';
import { createBillingClient } from '#lib/billing/client';
import { currencyToAsk, forgetCurrency, rememberCurrency } from '#lib/billing/currency';
import { money } from '#lib/billing/money';
import { checkoutRequest } from '#lib/billing/order';

/**
 * Premium in two currencies (the owner, 2026-11-14): Indian rupees for a visitor in India, US dollars elsewhere. The
 * billing service picks; the page asks, shows what it is told and sends the same currency back with the order.
 */

const USD = {
  plan: 'premium',
  currency: 'USD',
  amount: 40000,
  listAmount: 40000,
  offer: null,
  selling: true,
  currencies: ['USD', 'INR'],
};
const INR = { ...USD, currency: 'INR', amount: 3760000, listAmount: 3760000 };
const INR_LAUNCH = {
  ...INR,
  amount: 3186600,
  offer: { id: 'product-hunt', endsAt: '2026-11-26T08:01:00.000Z' },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A client whose service answers from `answer`, and the addresses it was asked at. */
function clientFor(answer: (url: URL) => unknown) {
  const asked: string[] = [];
  const fake = ((input: RequestInfo | URL) => {
    asked.push(String(input));
    return Promise.resolve(json(answer(new URL(String(input)))));
  }) as typeof fetch;
  return { client: createBillingClient({ base: 'https://billing.taalcut.app', fetch: fake }), asked };
}

describe('a quote’s currencies', () => {
  it('reads a quote in rupees, in paise, with the currencies the plan is sold in', () => {
    expect(parseQuote(INR)).toEqual(INR);
    expect(parseQuote(INR_LAUNCH)).toEqual(INR_LAUNCH);
    expect(parseQuote(USD)).toEqual(USD);
  });

  it('takes an answer that lists none as sold in its own currency alone', () => {
    const { currencies: _listed, ...older } = INR;
    expect(parseQuote(older)).toEqual({ ...older, currencies: ['INR'] });
  });

  it('refuses a list that isn’t one: not codes, repeated, empty, endless, or without the quote’s own currency', () => {
    for (const currencies of [
      null,
      'USD,INR',
      [],
      ['USD'],
      ['INR', 'INR'],
      ['INR', 'usd'],
      ['INR', 5],
      ['INR', 'RUPEE'],
      Array.from({ length: 13 }, (_, i) => `IN${String.fromCharCode(65 + i)}`),
    ]) {
      expect(parseQuote({ ...INR, currencies }), JSON.stringify(currencies)).toBeNull();
    }
  });

  it('reads the newer quote of a changed price in the order’s own currency', () => {
    expect(parseFailure({ code: 'billing.price_changed', quote: INR })).toEqual({
      kind: 'price-changed',
      quote: INR,
    });
  });
});

describe('asking for a quote in a currency', () => {
  it('asks for the visitor’s own currency unless one is named, and never without the question', async () => {
    const { client, asked } = clientFor((url) => (url.searchParams.get('currency') === 'USD' ? USD : INR));
    expect(AUTO_CURRENCY).toBe('auto');
    expect(await client.quote('premium', null)).toEqual({ ok: true, value: INR });
    expect(await client.quote('premium', 'producthunt', 'auto')).toEqual({ ok: true, value: INR });
    expect(await client.quote('premium', 'producthunt', 'USD')).toEqual({ ok: true, value: USD });
    expect(await client.quote('premium', null, 'INR')).toEqual({ ok: true, value: INR });
    expect(asked).toEqual([
      'https://billing.taalcut.app/v1/quote?plan=premium&currency=auto',
      'https://billing.taalcut.app/v1/quote?plan=premium&ref=producthunt&currency=auto',
      'https://billing.taalcut.app/v1/quote?plan=premium&ref=producthunt&currency=USD',
      'https://billing.taalcut.app/v1/quote?plan=premium&currency=INR',
    ]);
  });

  it('asks for the visitor’s own when what it is given isn’t a code', async () => {
    const { client, asked } = clientFor(() => USD);
    for (const typed of ['inr', 'rupees', '', '₹', 'US$']) await client.quote('premium', null, typed);
    expect(asked.map((url) => new URL(url).searchParams.get('currency'))).toEqual(Array(5).fill('auto'));
    expect([
      isCurrencyCode('INR'),
      isCurrencyCode('inr'),
      isCurrencyCode('auto'),
      isCurrencyCode(null),
    ]).toEqual([true, false, false, false]);
  });

  it('takes an answer in another currency than the one named as no answer', async () => {
    const { client } = clientFor(() => USD);
    expect(await client.quote('premium', null, 'INR')).toEqual({
      ok: false,
      failure: { kind: 'unexpected' },
    });
    // Asked for the visitor's own, whichever comes is the answer.
    expect(await client.quote('premium', null, 'auto')).toEqual({ ok: true, value: USD });
  });
});

describe('the currency a visitor chose', () => {
  beforeEach(forgetCurrency);

  it('is `auto` until someone chooses, then the choice, for as long as the page stays open', () => {
    expect(currencyToAsk()).toBe('auto');
    rememberCurrency('USD');
    expect(currencyToAsk()).toBe('USD');
    rememberCurrency('INR');
    expect(currencyToAsk()).toBe('INR');
    forgetCurrency();
    expect(currencyToAsk()).toBe('auto');
  });

  it('keeps nothing that isn’t a code', () => {
    for (const typed of ['auto', 'inr', '', '<script>']) rememberCurrency(typed);
    expect(currencyToAsk()).toBe('auto');
  });
});

describe('rupees and the order', () => {
  it('writes rupees with their sign, grouped the Indian way, and no decimals when whole', () => {
    expect(money(3760000, 'INR')).toBe('₹37,600');
    expect(money(3186600, 'INR')).toBe('₹31,866');
    expect(money(3186650, 'INR')).toBe('₹31,866.50');
    expect(money(10000000, 'INR')).toBe('₹1,00,000');
    // Dollars are as they were.
    expect(money(40000, 'USD')).toBe('$400');
    expect(money(33900, 'USD')).toBe('$339');
  });

  it('sends the currency the page showed with the amount it showed', () => {
    const answers = {
      name: 'Asha Rao',
      email: 'asha@example.com',
      whatsapp: '+919876543210',
      channel: '',
      agreed: true,
    };
    expect(
      checkoutRequest(answers, { plan: 'premium', ref: 'producthunt', currency: 'INR', expect: 3186600 }),
    ).toEqual({
      plan: 'premium',
      ref: 'producthunt',
      name: 'Asha Rao',
      email: 'asha@example.com',
      whatsapp: '+919876543210',
      agreed: true,
      currency: 'INR',
      expect: 3186600,
    });
  });
});
