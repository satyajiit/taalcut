// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations, PREMIUM_RULES } from '#content/claims';
import {
  PRIVACY_PREMIUM,
  PRIVACY_PREMIUM_GIST,
  PRIVACY_PREMIUM_PROCESSORS,
  PRIVACY_PREMIUM_WHERE,
  TERMS_PREMIUM,
} from '#content/legal-premium';
import { page } from '#content/pages';
import {
  FAQ_PREMIUM,
  FAQ_STILL_FREE,
  LIST_PRICE,
  OFFER,
  ORDER,
  PER_MONTH,
  PREMIUM,
  PREMIUM_MATERIAL,
  PREMIUM_MIRROR,
  PREMIUM_NEEDS,
  PREMIUM_PAGE,
  PREMIUM_POINTERS,
  PREMIUM_QUESTIONS,
  PREMIUM_SENDER,
  THANKS,
  offerName,
} from '#content/premium';
import { SITE } from '#content/site';
import type { FailureKind } from '#lib/billing/api';
import { BILLING_DEFAULT } from '#lib/billing/origin';
import { premiumJsonLd } from '#lib/jsonld';
import { pageMarkdown } from '#lib/llms/pages-md';

/**
 * Taalcut Premium's own words (content/premium.ts): the plan's constants, what the page must say, and the ledger over
 * every Premium string. Where Premium sits beside the free app, and its sections of the terms and the privacy notice,
 * are premium-site.test.ts.
 */

/** Every string in a content object, however deep; a function of words is called with plain words. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function')
    return strings(
      (value as (...words: string[]) => unknown)('26 November 2026', '26 November at 13:31 IST'),
    );
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

/** Everything the site says about Premium: the pages' words, the terms, the privacy notice and the machine-read files. */
const PREMIUM_COPY = strings([
  PREMIUM,
  LIST_PRICE,
  PER_MONTH,
  OFFER,
  PREMIUM_NEEDS,
  PREMIUM_MATERIAL,
  PREMIUM_PAGE,
  PREMIUM_QUESTIONS,
  FAQ_STILL_FREE,
  FAQ_PREMIUM,
  ORDER,
  THANKS,
  PREMIUM_POINTERS,
  PREMIUM_MIRROR,
  TERMS_PREMIUM,
  PRIVACY_PREMIUM,
  PRIVACY_PREMIUM_GIST,
  PRIVACY_PREMIUM_PROCESSORS,
  PRIVACY_PREMIUM_WHERE,
  page('/premium/').title,
  page('/premium/').description,
  page('/premium/thanks/').title,
  page('/premium/thanks/').description,
  pageMarkdown(page('/premium/')),
  JSON.stringify(premiumJsonLd()),
]);

describe('Taalcut Premium: the plan’s constants', () => {
  it('names the plan, its list price and its window as the billing service’s catalogue does', () => {
    expect(PREMIUM).toMatchObject({
      name: 'Taalcut Premium',
      path: '/premium/',
      thanksPath: '/premium/thanks/',
      plan: 'premium',
      currency: 'USD',
      listAmount: 40000,
      activationDays: 7,
    });
    expect(LIST_PRICE).toBe('$400');
    expect(BILLING_DEFAULT).toBe('https://billing.taalcut.app');
  });

  it('names each launch price the billing service can quote, and any other as a launch price', () => {
    expect(offerName('product-hunt')).toBe('Product Hunt launch price');
    expect(offerName('launch-day')).toBe('Launch day price');
    expect(offerName('something-new')).toBe('Launch price');
    // A launch price is the first month's: said wherever one is shown.
    expect(OFFER.first).toBe('for your first month');
    expect(OFFER.later).toBe('Later months are $400 a month.');
  });

  it('lists what the owner put in the plan, and the four steps from payment to active', () => {
    const included = PREMIUM_PAGE.included.rows.map(([, value]) => value).join('\n');
    for (const said of [
      'We install Taalcut on your Mac and set it up with you.',
      'One live setup session, by screen share (TeamViewer or Google Meet).',
      'The top cloud models, paid by us: no keys, no model bills of your own.',
      'Every make runs on the top models instead of the on-device ones.',
      'WhatsApp support around the clock, Monday to Friday.',
      'Advice for Instagram, YouTube and other creator platforms: formats, hooks, posting rhythm.',
      'An AI-native agency on call',
    ]) {
      expect(included, said).toContain(said);
    }
    expect(PREMIUM_PAGE.included.rows).toHaveLength(10);
    const steps = PREMIUM_PAGE.activation.steps;
    expect(steps).toHaveLength(4);
    expect(steps[1]!.body).toMatch(/Within one business day we write to you/);
    expect(steps[2]!.body).toMatch(/screen share/);
    expect(steps[3]!.body).toMatch(/active within 7 days of payment, and your paid month starts that day/);
  });

  it('says the plain notes before an order', () => {
    const notes = Object.fromEntries(PREMIUM_PAGE.notes.rows);
    expect(notes['What it needs']).toBe(
      `A Mac with Apple silicon on macOS 14 or later, the same as the app.`,
    );
    expect(notes['Where your material goes']).toMatch(
      /^Premium sends the material a make needs to cloud models/,
    );
    expect(notes['Where your material goes']).toMatch(/The free app’s on-device mode is unchanged\.$/);
    expect(notes['Fair use']).toMatch(
      /one creator’s own publishing: not for resale, and not for automated bulk runs/,
    );
    expect(notes['Advice']).toMatch(/Nobody can promise reach, views or income, and we don’t/);
    expect(notes['Agency work']).toMatch(/scoped with you and quoted before it starts/);
    expect(notes['Support hours']).toMatch(/Monday 00:00 to Friday 24:00, India time/);
    expect(notes['Paying']).toContain('(/terms/#premium)');
    expect(notes['Paying']).toContain('(/terms/#premium-refunds)');
  });
});

describe('Taalcut Premium: the words', () => {
  it('hold to the truth ledger', () => {
    expect(PREMIUM_COPY.flatMap(claimViolations)).toEqual([]);
  });

  it('never call Premium a stage of something', () => {
    const stage = /\b(trials?|pilots?|betas?|early[- ]birds?|waitlists?|experiment(s|al)?)\b/i;
    expect(PREMIUM_COPY.filter((text) => stage.test(text))).toEqual([]);
  });

  it('carry one address, and no date typed by hand', () => {
    const addresses = PREMIUM_COPY.flatMap((text) => text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []);
    expect(addresses.length).toBeGreaterThan(5);
    // One address to write to. The other is the sender of the one email a paid order sends: named only where the
    // site lists the messages a buyer gets, never as a link, and never as somewhere to write.
    expect(new Set(addresses)).toEqual(new Set([SITE.email, PREMIUM_SENDER]));
    expect(SITE.email).toBe('admin@matterwardlabs.com');
    expect(PREMIUM_SENDER).toBe('premium@taalcut.app');
    const naming = PREMIUM_COPY.filter((text) => text.includes(PREMIUM_SENDER) && !text.startsWith('# '));
    expect(naming).toEqual([
      THANKS.paid.emails,
      strings(PRIVACY_PREMIUM).find((text) => text.startsWith('One email from us')),
    ]);
    expect(PREMIUM_COPY.filter((text) => /mailto:(?!admin@matterwardlabs\.com)/.test(text))).toEqual([]);
    for (const text of naming) expect(text).not.toMatch(/write to premium@|\[premium@/i);
    // The launch prices' days come from the billing service's quote: none is written into the site.
    expect(PREMIUM_COPY.filter((text) => /\b20\d\d\b/.test(text.replace('26 November 2026', '')))).toEqual(
      [],
    );
    expect(PREMIUM_COPY.filter((text) => /\$339|33900/.test(text))).toEqual([]);
  });

  it('are caught by the ledger when they promise, pretend or name the stack', () => {
    for (const bad of [
      'Start your free trial of Premium',
      'Join the Premium pilot',
      'Early-bird price ends soon',
      'Premium is an experiment',
      'Results guaranteed',
      'We guarantee more views',
      'Grow your reach with Premium',
      'Your reel goes viral',
      'Unlimited makes on the top models',
      'The top models always finish a make',
      'A make that works every time',
      'Creators already use Premium',
      'Premium members love the setup session',
      'Join hundreds of creators',
      'You pay through Razorpay',
      'Card payments by Stripe',
    ]) {
      expect(claimViolations(bad), bad).not.toEqual([]);
    }
    expect(PREMIUM_RULES.length).toBeGreaterThanOrEqual(7);
    for (const good of [
      'You pay on our payment provider’s page.',
      'Advice is advice. Nobody can promise reach, views or income, and we don’t.',
      'A make can still fail on any model.',
      'Every make runs on the top models instead of the on-device ones.',
      'One live setup session, by screen share (TeamViewer or Google Meet).',
      'New features reach you first.',
    ]) {
      expect(claimViolations(good), good).toEqual([]);
    }
  });

  it('give each refusal its own sentence, and say nothing was charged where that is the worry', () => {
    const kinds: Exclude<FailureKind, 'not-selling' | 'forbidden'>[] = [
      'invalid',
      'not-found',
      'price-changed',
      'rate-limited',
      'busy',
      'provider-unavailable',
      'offline',
      'timeout',
      'unreachable',
      'unexpected',
    ];
    expect(Object.keys(ORDER.refusals).sort()).toEqual([...kinds].sort());
    const said = kinds.map((kind) => ORDER.refusals[kind]);
    expect(new Set(said).size).toBe(kinds.length);
    for (const kind of ['busy', 'provider-unavailable', 'timeout', 'unreachable', 'unexpected'] as const) {
      expect(ORDER.refusals[kind], kind).toMatch(/Nothing was charged\.$/);
    }
    expect(ORDER.refusals['price-changed']).toMatch(
      /^The price changed while this page was open\. Check the new price/,
    );
    // A wait can be hours (a caller's daily allowance): the line names the wait the service gave or says later,
    // never a short one, and gives the address either way.
    const mail = `[${SITE.email}](mailto:${SITE.email})`;
    expect(ORDER.rateLimitedFor('5 hours')).toBe(
      `Too many tries from here. Try again in 5 hours, or write to ${mail}.`,
    );
    expect(ORDER.refusals['rate-limited']).toBe(
      `Too many tries from here. Try again later, or write to ${mail}.`,
    );
    expect(
      strings([ORDER.refusals, THANKS]).filter((text) => /\b(a moment|a minute|shortly|soon)\b/.test(text)),
    ).toEqual([THANKS.checking.body, THANKS.pending.body]);
    // Orders off, or the billing service out of reach: one sentence and the address. And the line for a card from India.
    expect(ORDER.closed).toBe(
      `We can’t take orders on this page right now. Write to [${SITE.email}](mailto:${SITE.email}) and we send you a payment link.`,
    );
    expect(ORDER.india).toMatch(
      /^A card issued in India usually can’t pay in US dollars\. Write to \[admin@matterwardlabs\.com\]/,
    );
  });

  it('ask for the WhatsApp number and say why: the payment page needs a phone number', () => {
    expect(ORDER.whatsappWhy).toBe(
      'Our payment provider needs a phone number to make your payment page, and we use it to book your setup session and for support.',
    );
    expect(ORDER.problems.whatsappEmpty).toBe('Add your number, like +14155550100.');
    expect(ORDER.problems.whatsapp).toBe('Start with + and your country code.');
    expect(ORDER.whatsappHint).toBe('With your country code, like +14155550100');
  });

  it('give each state of a returning payment its own words, each ending at the address', () => {
    const states = [
      THANKS.checking,
      THANKS.pending,
      THANKS.expired,
      THANKS.cancelled,
      THANKS.missing,
      THANKS.refused,
      THANKS.unreachable,
    ];
    expect(new Set([THANKS.paid.heading, ...states.map((s) => s.heading)]).size).toBe(states.length + 1);
    expect(THANKS.pending.body).toMatch(
      /It can take a minute to reach us\. The receipt our payment provider emails you is proof of payment\./,
    );
    expect(THANKS.expired.body).toMatch(/^Nothing was charged/);
    expect(THANKS.cancelled.body).toMatch(/^Nothing was charged/);
    expect(THANKS.paid.activeBy('26 November 2026')).toMatch(
      /^Your plan is active by 26 November 2026, and your paid month starts on the day it is\./,
    );
    expect(THANKS.paid.next[0]).toMatch(/^Within one business day we write to you/);
    expect(THANKS.write).toContain(`mailto:${SITE.email}`);
    // The messages a buyer gets, exactly: the provider's receipt and one email from the billing service.
    expect(THANKS.paid.emails).toBe(
      'You get two emails: our payment provider’s receipt, and one from Taalcut (premium@taalcut.app) saying your payment is in and what happens next.',
    );
    expect(THANKS.unreachable.body).toBe('Your payment isn’t affected. Check again later, or write to us.');
  });
});
