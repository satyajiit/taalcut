// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';

import { readCatalog } from '../src/config/catalog';
import { billingConfig } from '../src/config/env';
import { currenciesOf, currencyFor, normaliseRef, priceOf } from '../src/pricing/quote';
import { BEFORE_LAUNCH, CATALOG, createTestBilling, LAUNCH_DAY, LAUNCH_WEEK, SITE } from './harness';

const AFTER_LAUNCH_WEEK = Date.parse('2026-11-27T00:00:00Z');

async function quote(billing: ReturnType<typeof createTestBilling>, query: string): Promise<unknown> {
  const response = await billing.request(`/v1/quote?${query}`, { headers: { origin: SITE } });
  expect(response.status).toBe(200);
  return response.json();
}

describe('the price', () => {
  it('is the list price before the launch, whatever the visitor arrived with', async () => {
    const billing = createTestBilling({ now: BEFORE_LAUNCH });
    const list = {
      plan: 'premium',
      currency: 'USD',
      amount: 40000,
      listAmount: 40000,
      offer: null,
      selling: true,
      currencies: ['USD', 'INR'],
    };
    expect(await quote(billing, 'plan=premium')).toEqual(list);
    expect(await quote(billing, 'plan=premium&ref=producthunt')).toEqual(list);
  });

  it('is the launch price for everyone on launch day', async () => {
    const billing = createTestBilling({ now: LAUNCH_DAY });
    expect(await quote(billing, 'plan=premium')).toEqual({
      plan: 'premium',
      currency: 'USD',
      amount: 33900,
      listAmount: 40000,
      offer: { id: 'launch-day', endsAt: '2026-11-20T08:01:00.000Z' },
      selling: true,
      currencies: ['USD', 'INR'],
    });
  });

  it('names the offer that runs longer when two give the same price', async () => {
    const billing = createTestBilling({ now: LAUNCH_DAY });
    expect(await quote(billing, 'plan=premium&ref=producthunt')).toMatchObject({
      amount: 33900,
      offer: { id: 'product-hunt', endsAt: '2026-11-26T08:01:00.000Z' },
    });
  });

  it('is the launch price in launch week only for a visitor from Product Hunt', async () => {
    const billing = createTestBilling({ now: LAUNCH_WEEK });
    expect(await quote(billing, 'plan=premium')).toMatchObject({ amount: 40000, offer: null });
    expect(await quote(billing, 'plan=premium&ref=ProductHunt')).toMatchObject({ amount: 33900 });
    expect(await quote(billing, 'plan=premium&ref=twitter')).toMatchObject({ amount: 40000, offer: null });
  });

  it('goes back to the list price the moment an offer ends', async () => {
    const billing = createTestBilling({ now: AFTER_LAUNCH_WEEK });
    expect(await quote(billing, 'plan=premium&ref=producthunt')).toMatchObject({
      amount: 40000,
      offer: null,
    });
    const catalog = readCatalog(CATALOG);
    if (!catalog) throw new Error('the test catalogue is malformed');
    const end = Date.parse('2026-11-26T08:01:00Z');
    expect(priceOf(catalog, 'premium', 'producthunt', end - 1)?.amount).toBe(33900);
    expect(priceOf(catalog, 'premium', 'producthunt', end)?.amount).toBe(40000);
  });

  it('refuses a plan that is not sold and a request that names none', async () => {
    const billing = createTestBilling();
    const unknown = await billing.request('/v1/quote?plan=gold');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ code: 'billing.not_found' });
    const missing = await billing.request('/v1/quote');
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      code: 'billing.invalid',
      problems: [{ path: 'plan', rule: 'required' }],
    });
    // `__proto__` is a key of every object; it is not a plan.
    expect((await billing.request('/v1/quote?plan=__proto__')).status).toBe(404);
  });

  it('reads a ref as a code only when it could be one', () => {
    expect(normaliseRef(' ProductHunt ')).toBe('producthunt');
    expect(normaliseRef('a b')).toBeUndefined();
    expect(normaliseRef('x'.repeat(41))).toBeUndefined();
    expect(normaliseRef(null)).toBeUndefined();
  });

  it('limits how often one caller may ask', async () => {
    const billing = createTestBilling({ readLimit: 2 });
    const headers = { 'cf-connecting-ip': '203.0.113.9' };
    expect((await billing.request('/v1/quote?plan=premium', { headers })).status).toBe(200);
    expect((await billing.request('/v1/quote?plan=premium', { headers })).status).toBe(200);
    const third = await billing.request('/v1/quote?plan=premium', { headers });
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBe('60');
    expect(await third.json()).toEqual({ code: 'billing.rate_limited', retryAfterSeconds: 60 });
  });
});

describe('the currency', () => {
  const rupees = { currency: 'INR', amount: 3760000, listAmount: 3760000, offer: null };
  const dollars = { currency: 'USD', amount: 40000, listAmount: 40000, offer: null };

  it('stays US dollars for a page that names none, wherever the visitor is', async () => {
    const billing = createTestBilling();
    billing.visitor.country = 'IN';
    expect(await quote(billing, 'plan=premium')).toMatchObject(dollars);
  });

  it('is rupees for a visitor in India who asks for their own, and dollars for everyone else', async () => {
    const billing = createTestBilling();
    expect(await quote(billing, 'plan=premium&currency=auto')).toMatchObject(dollars);
    billing.visitor.country = 'US';
    expect(await quote(billing, 'plan=premium&currency=auto')).toMatchObject(dollars);
    billing.visitor.country = 'IN';
    expect(await quote(billing, 'plan=premium&currency=auto')).toEqual({
      plan: 'premium',
      ...rupees,
      selling: true,
      currencies: ['USD', 'INR'],
    });
  });

  it('is the currency the page names, wherever the visitor is', async () => {
    const billing = createTestBilling();
    expect(await quote(billing, 'plan=premium&currency=INR')).toMatchObject(rupees);
    billing.visitor.country = 'IN';
    expect(await quote(billing, 'plan=premium&currency=USD')).toMatchObject(dollars);
  });

  it('has the launch prices in rupees, on the same days and with the same ref', async () => {
    const day = createTestBilling({ now: LAUNCH_DAY });
    expect(await quote(day, 'plan=premium&currency=INR')).toMatchObject({
      currency: 'INR',
      amount: 3186600,
      listAmount: 3760000,
      offer: { id: 'launch-day', endsAt: '2026-11-20T08:01:00.000Z' },
    });
    const week = createTestBilling({ now: LAUNCH_WEEK });
    week.visitor.country = 'IN';
    expect(await quote(week, 'plan=premium&currency=auto')).toMatchObject(rupees);
    expect(await quote(week, 'plan=premium&currency=auto&ref=producthunt')).toMatchObject({
      currency: 'INR',
      amount: 3186600,
      offer: { id: 'product-hunt', endsAt: '2026-11-26T08:01:00.000Z' },
    });
    // A dollar offer never prices a rupee quote, nor the other way round.
    expect(await quote(week, 'plan=premium&ref=producthunt')).toMatchObject({
      currency: 'USD',
      amount: 33900,
    });
  });

  it('refuses a currency the plan is not sold in', async () => {
    const billing = createTestBilling();
    for (const currency of ['EUR', 'inr', 'AUTO', '']) {
      const response = await billing.request(`/v1/quote?plan=premium&currency=${currency}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        code: 'billing.invalid',
        problems: [{ path: 'currency', rule: 'unknown' }],
      });
    }
    // The plan is asked first: a plan that is not sold is not found, whatever the currency.
    expect((await billing.request('/v1/quote?plan=gold&currency=EUR')).status).toBe(404);
  });

  it('falls back to the plan’s default when the visitor’s currency is not one of the plan’s', () => {
    const catalog = readCatalog({
      plans: { premium: { label: 'Premium', prices: { INR: 3760000, USD: 40000 } } },
      currencyByCountry: { IN: 'INR', DE: 'EUR' },
    });
    if (!catalog) throw new Error('the test catalogue is malformed');
    // US dollars lead, however the prices are written down.
    expect(currenciesOf(catalog, 'premium')).toEqual(['USD', 'INR']);
    expect(currenciesOf(catalog, 'gold')).toBeNull();
    expect(currencyFor(catalog, 'premium', 'auto', 'IN')).toBe('INR');
    expect(currencyFor(catalog, 'premium', 'auto', 'DE')).toBe('USD');
    expect(currencyFor(catalog, 'premium', 'auto', null)).toBe('USD');
    expect(currencyFor(catalog, 'premium', undefined, 'IN')).toBe('USD');
    expect(currencyFor(catalog, 'premium', 'EUR', 'DE')).toBeNull();
    expect(currencyFor(catalog, 'gold', 'auto', 'IN')).toBeNull();
    expect(priceOf(catalog, 'premium', undefined, 0, 'EUR')).toBeNull();
  });

  it('reads a catalogue with no country map as dollars for everyone, and refuses a malformed map', () => {
    const plans = { premium: { label: 'Premium', prices: { USD: 40000, INR: 3760000 } } };
    const plain = readCatalog({ plans });
    expect(plain?.currencyByCountry).toEqual({});
    expect(plain && currencyFor(plain, 'premium', 'auto', 'IN')).toBe('USD');
    expect(readCatalog({ plans, currencyByCountry: { india: 'INR' } })).toBeNull();
    expect(readCatalog({ plans, currencyByCountry: { IN: 'rupees' } })).toBeNull();
  });
});

describe('the configuration', () => {
  it('quotes but does not sell without a key pair', async () => {
    const billing = createTestBilling({ env: { RAZORPAY_KEY_SECRET: undefined } });
    expect(await quote(billing, 'plan=premium')).toMatchObject({ amount: 40000, selling: false });
    expect(await (await billing.request('/v1/health')).json()).toEqual({ ok: true, selling: false });
  });

  it('does not sell with a key of the other mode', async () => {
    const billing = createTestBilling({ env: { MODE: 'test' } });
    expect(await quote(billing, 'plan=premium')).toMatchObject({ selling: false });
  });

  it('does not sell while selling is switched off', async () => {
    const billing = createTestBilling({ env: { SELLING: 'off' } });
    expect(await quote(billing, 'plan=premium')).toMatchObject({ selling: false });
  });

  it('answers nothing but "not selling" when its variables are malformed', async () => {
    for (const env of [
      { CATALOG: 'not json' },
      { SITE_ORIGIN: 'taalcut.app' },
      { ALLOWED_ORIGINS: 'https://a.example, b' },
    ]) {
      const billing = createTestBilling({ env });
      const response = await billing.request('/v1/quote?plan=premium');
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: 'billing.not_selling' });
    }
  });

  it('refuses a catalogue whose offer is not a lower price for a real plan over a real span', () => {
    const plans = CATALOG.plans;
    const offer = CATALOG.offers[0];
    expect(readCatalog({ plans, offers: [{ ...offer, amount: 40000 }] })).toBeNull();
    expect(readCatalog({ plans, offers: [{ ...offer, plan: 'gold' }] })).toBeNull();
    expect(readCatalog({ plans, offers: [{ ...offer, currency: 'EUR' }] })).toBeNull();
    expect(readCatalog({ plans, offers: [{ ...offer, endsAt: offer?.startsAt }] })).toBeNull();
    expect(readCatalog({ plans, offers: [{ ...offer, startsAt: 'soon' }] })).toBeNull();
    expect(readCatalog(JSON.stringify(CATALOG))?.offers).toHaveLength(4);
  });

  it('reads the deployed configuration: list 400, launch 339, the launch times', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    // JSONC: drop whole-line comments and trailing commas.
    const config: unknown = JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
    const vars: unknown = Reflect.get(config as object, 'vars');
    const keys = { RAZORPAY_KEY_ID: 'rzp_live_Abcdef123456', RAZORPAY_KEY_SECRET: 'x'.repeat(24) };
    const read = billingConfig({ ...(vars as object), ...keys });
    // The file's own switch decides whether it sells with the key pair set; switched on, it does.
    expect(read?.selling).toBe(Reflect.get(vars as object, 'SELLING') === 'on');
    expect(billingConfig({ ...(vars as object), ...keys, SELLING: 'on' })?.selling).toBe(true);
    expect(billingConfig({ ...(vars as object), ...keys, SELLING: 'off' })?.selling).toBe(false);
    expect(read?.allowedOrigins.has('https://taalcut.app')).toBe(true);
    const catalog = read?.catalog;
    if (!catalog) throw new Error('wrangler.jsonc has no readable catalogue');
    const launch = Date.parse('2026-11-19T08:01:00Z');
    expect(priceOf(catalog, 'premium', undefined, launch - 1)?.amount).toBe(40000);
    expect(priceOf(catalog, 'premium', undefined, launch)?.amount).toBe(33900);
    expect(priceOf(catalog, 'premium', undefined, launch + 86_400_000)?.amount).toBe(40000);
    expect(priceOf(catalog, 'premium', 'producthunt', launch + 86_400_000)?.amount).toBe(33900);
    expect(priceOf(catalog, 'premium', 'producthunt', launch + 7 * 86_400_000)?.amount).toBe(40000);
  });
});
