// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Taalcut Premium's numbers are written in two packages that cannot import each other: the billing Worker's
 * catalogue (what is charged) and the website's content (what the static pages and the machine-read files say).
 * The pages show the Worker's quote at run time; this test keeps the words that are written down in step with it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

/** The value at `path` inside parsed JSON, or undefined. */
function at(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path)
    current = typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined;
  return current;
}

/** The Worker's variables: wrangler.jsonc as JSON, whole-line comments and trailing commas removed. */
function workerVars(): unknown {
  const text = read('services/billing-worker/wrangler.jsonc')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  const config: unknown = JSON.parse(text);
  return at(config, 'vars');
}

/** The value of `name:` in the website's Premium content. */
function siteValue(source: string, name: string): string {
  const found = new RegExp(`\\b${name}:\\s*(?:'([^']*)'|(\\d+))`).exec(source);
  const value = found?.[1] ?? found?.[2];
  if (value === undefined) throw new Error(`website/src/content/premium.ts has no ${name}`);
  return value;
}

/** The rupee prices are the dollar prices at this rate, with nothing added (the owner, 2026-11-14). */
const RUPEES_PER_DOLLAR = 94;

describe('Taalcut Premium: the website and the billing Worker agree', () => {
  const vars = workerVars();
  const site = read('website/src/content/premium.ts');
  const plan = siteValue(site, 'plan');
  const currency = siteValue(site, 'currency');
  const offers = at(vars, 'CATALOG', 'offers');

  it('on the plan, its currency and its list price', () => {
    expect(at(vars, 'CATALOG', 'plans', plan, 'prices', currency)).toBe(
      Number(siteValue(site, 'listAmount')),
    );
  });

  it('on the rupee price a visitor in India is shown: the dollar price at the owner’s rate', () => {
    const india = /\bindia:\s*\{\s*currency:\s*'([A-Z]{3})',\s*listAmount:\s*(\d+)\s*\}/.exec(site);
    if (!india) throw new Error('website/src/content/premium.ts has no india price');
    const [, rupees, amount] = india;
    expect(rupees).toBe('INR');
    expect(at(vars, 'CATALOG', 'plans', plan, 'prices', 'INR')).toBe(Number(amount));
    expect(at(vars, 'CATALOG', 'currencyByCountry')).toEqual({ IN: 'INR' });
    // Both are in hundredths, so the rate applies to the minor units as it does to the price.
    expect(Number(amount)).toBe(Number(siteValue(site, 'listAmount')) * RUPEES_PER_DOLLAR);
  });

  it('on the name of every offer the Worker can quote, and on each offer’s price in rupees', () => {
    if (!Array.isArray(offers) || offers.length === 0)
      throw new Error('the Worker’s catalogue has no offers');
    const priced = Object.keys(Object(at(vars, 'CATALOG', 'plans', plan, 'prices')));
    const terms = (offer: unknown, amount: unknown): string =>
      JSON.stringify([
        at(offer, 'id'),
        at(offer, 'code'),
        at(offer, 'startsAt'),
        at(offer, 'endsAt'),
        amount,
      ]);
    const inRupees = new Set(
      offers
        .filter((offer) => at(offer, 'currency') === 'INR')
        .map((offer) => terms(offer, at(offer, 'amount'))),
    );
    for (const offer of offers) {
      expect(at(offer, 'plan')).toBe(plan);
      expect(priced).toContain(at(offer, 'currency'));
      const id = String(at(offer, 'id'));
      expect(site, `the website has no name for the offer "${id}"`).toContain(`'${id}':`);
      // A launch price is one price in two currencies: the same offer, days and ref, at the owner’s rate.
      if (at(offer, 'currency') === currency)
        expect(inRupees, `the offer "${id}" has no rupee price`).toContain(
          terms(offer, Number(at(offer, 'amount')) * RUPEES_PER_DOLLAR),
        );
    }
    expect(inRupees.size * 2).toBe(offers.length);
  });

  it('on how many days a plan may take to be active', () => {
    const worker = /ACTIVATION_DAYS = (\d+)/.exec(
      read('services/billing-worker/src/notify/messages.ts'),
    )?.[1];
    expect(worker).toBe(siteValue(site, 'activationDays'));
  });

  it('on the address the buyer comes back to, and on who may read the Worker’s answers', () => {
    const origin = /origin: '([^']+)'/.exec(read('website/src/content/site.ts'))?.[1];
    expect(at(vars, 'SITE_ORIGIN')).toBe(origin);
    expect(String(at(vars, 'ALLOWED_ORIGINS')).split(',')).toContain(origin);
    // The Worker sends the buyer back to the very path the website serves.
    const thanks = siteValue(site, 'thanksPath');
    expect(read('services/billing-worker/src/orders/create-order.ts')).toContain(
      `\${config.siteOrigin}${thanks}\``,
    );
  });
});
