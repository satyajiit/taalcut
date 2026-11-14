// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import sitemap from '../../src/app/sitemap';
import { COST_SECTION } from '#content/cost';
import { FAQ } from '#content/faq';
import { PRIVACY, PRIVACY_GIST, TERMS } from '#content/legal';
import { PRIVACY_PREMIUM_PROCESSORS, PRIVACY_PREMIUM_WHERE } from '#content/legal-premium';
import { LLMS } from '#content/llms';
import { PAGES, page } from '#content/pages';
import {
  FAQ_PREMIUM,
  FAQ_STILL_FREE,
  ORDER,
  PREMIUM,
  PREMIUM_PAGE,
  PREMIUM_POINTERS,
  PREMIUM_QUESTIONS,
} from '#content/premium';
import { FOOTER_GROUPS, LICENCE_LINE, NAV, SITE } from '#content/site';
import { OUTCOME_KEY } from '#lib/billing/outcome';
import { TAGGED_PATH } from '#lib/billing/ref';
import { premiumJsonLd, softwareApplicationJsonLd } from '#lib/jsonld';
import { llmsFullTxt, llmsTxt } from '#lib/llms/llms-txt';
import { listedPages } from '#lib/llms/mirror';
import { pageMarkdown } from '#lib/llms/pages-md';
import { absolute } from '#lib/seo';

/**
 * Taalcut Premium in the rest of the site: beside an app that stays free (the FAQ, the page list, the navigation, the
 * mirrors, the structured data), and in the terms and the privacy notice. Its own words are premium.test.ts.
 */

/** Every string in a content object, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('Taalcut Premium beside the free app', () => {
  it('keeps both true: the app is free, and Premium is a paid service around it', () => {
    expect(LICENCE_LINE).toMatch(/^Taalcut is free\./);
    expect(COST_SECTION.lead).toMatch(/^Taalcut is free/);
    expect(FAQ_STILL_FREE.answer).toMatch(/^Yes\. The app is free/);
    expect(FAQ_STILL_FREE.answer).toMatch(
      /Premium is a paid service around the app, and it takes nothing out of the free app\./,
    );
    expect(FAQ_PREMIUM.answer).toContain('$400 a month');
    const ids = FAQ.map((entry) => entry.id);
    expect(ids).toContain('still-free');
    expect(ids).toContain('premium');
    expect(FAQ.find((entry) => entry.id === 'still-free')).toMatchObject({
      question: 'Is Taalcut still free?',
      answer: FAQ_STILL_FREE.answer,
    });
    expect(FAQ.find((entry) => entry.id === 'premium')).toMatchObject({
      question: 'What is Premium?',
      answer: FAQ_PREMIUM.answer,
    });
    const cost = FAQ.find((entry) => entry.id === 'cost')!.answer;
    expect(cost).toMatch(/^Taalcut is free\./);
    expect(cost).toMatch(/Taalcut Premium is a paid plan around the app, at \$400 a month/);
    // No sentence says nothing at all is ever paid to Taalcut.
    const everything = [...strings(FAQ), ...strings(LLMS), llmsTxt(), llmsFullTxt()].join('\n');
    expect(everything).not.toMatch(
      /you pay nothing to Taalcut|there is no Taalcut cloud to pay for|Taalcut doesn’t run AI for you/,
    );
  });

  it('is on the page list, the sitemap, the navigation and the footer; the thanks page is unlisted', () => {
    expect(page('/premium/')).toMatchObject({ title: 'Taalcut Premium', section: 'Product' });
    expect(page('/premium/').unlisted).toBeFalsy();
    expect(page('/premium/').description.length).toBeLessThanOrEqual(160);
    expect(page('/premium/thanks/')).toMatchObject({ unlisted: true });
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(absolute('/premium/'));
    expect(urls).not.toContain(absolute('/premium/thanks/'));
    expect(listedPages().map((p) => p.path)).toContain('/premium/');
    expect(listedPages().map((p) => p.path)).not.toContain('/premium/thanks/');
    expect(NAV.map((link) => link.href)).toEqual(['/features/', '/ai/', '/premium/']);
    expect(FOOTER_GROUPS.flatMap((group) => group.links.map((link) => link.href))).toContain('/premium/');
    expect(PAGES.filter((p) => p.path.startsWith('/premium/'))).toHaveLength(2);
    // The one address a visit's tag is carried to is the plan's own page.
    expect(TAGGED_PATH).toBe(PREMIUM.path);
  });

  it('has a mirror with the page’s own words, and a line in llms.txt', () => {
    const mirror = pageMarkdown(page('/premium/'));
    expect(mirror).toContain('$400 a month, in US dollars.');
    for (const [, value] of PREMIUM_PAGE.included.rows) expect(mirror, value).toContain(value);
    for (const step of PREMIUM_PAGE.activation.steps) expect(mirror, step.title).toContain(step.body);
    for (const entry of PREMIUM_QUESTIONS) expect(mirror, entry.id).toContain(entry.answer);
    expect(mirror).toContain(`[${SITE.email}](mailto:${SITE.email})`);
    expect(mirror).toContain(`(${absolute('/terms/#premium-refunds')})`);
    expect(llmsTxt()).toContain(PREMIUM_POINTERS.machine);
    expect(llmsFullTxt()).toContain('# Taalcut Premium');
    expect(pageMarkdown(page('/download/'))).toContain(
      `[Taalcut Premium](${absolute('/premium/')}) is $400 a month.`,
    );
    expect(pageMarkdown(page('/'))).toContain('Would you rather we set it up and pay for the models?');
  });

  it('is an Offer of 400 US dollars a month in the structured data, beside an app that is still free', () => {
    const service = premiumJsonLd();
    expect(service).toMatchObject({
      '@type': 'Service',
      name: 'Taalcut Premium',
      url: absolute('/premium/'),
      offers: {
        '@type': 'Offer',
        price: '400.00',
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: '400.00',
          priceCurrency: 'USD',
          billingDuration: 'P1M',
        },
      },
    });
    expect(JSON.stringify(service)).toContain(SITE.company.legal);
    const app = softwareApplicationJsonLd();
    expect(app).not.toHaveProperty('offers');
    expect(app).toMatchObject({ isAccessibleForFree: true });
  });
});

describe('Taalcut Premium in the terms and the privacy notice', () => {
  const termsIds = TERMS.sections.map((s) => s.id);
  const privacyIds = PRIVACY.sections.map((s) => s.id);
  const said = (id: string, doc = TERMS) => strings(doc.sections.find((s) => s.id === id)).join('\n');

  it('gives the form’s links a section each to land on', () => {
    expect(termsIds).toContain('premium');
    expect(termsIds).toContain('premium-refunds');
    expect(privacyIds).toContain('premium');
    expect(new Set(termsIds).size).toBe(termsIds.length);
    expect(new Set(privacyIds).size).toBe(privacyIds.length);
    const anchors = [ORDER.agree, ORDER.privacy, ...strings(PREMIUM_PAGE.notes)].flatMap((text) => [
      ...text.matchAll(/\]\(\/(terms|privacy)\/#([a-z-]+)\)/g),
    ]);
    expect(anchors.length).toBeGreaterThanOrEqual(5);
    for (const [, doc, id] of anchors)
      expect(doc === 'terms' ? termsIds : privacyIds, `${doc}#${id}`).toContain(id);
    expect(ORDER.agree).toBe(
      'I agree to the [Premium terms](/terms/#premium) and the [refund and cancellation terms](/terms/#premium-refunds).',
    );
  });

  it('says who sells it, what it costs and how it is paid for', () => {
    const terms = said('premium');
    expect(terms).toContain(SITE.company.legal);
    expect(terms).toContain('$400 a month, in US dollars.');
    expect(terms).toMatch(/launch price, it is the price of your first month, and later months are \$400/);
    expect(terms).toMatch(/Each month we send you one payment link/);
    expect(terms).toMatch(/We keep no card, and nothing is charged automatically/);
    expect(terms).toMatch(/Your plan is active within 7 days of your payment/);
    expect(terms).toMatch(/Your paid month starts on the day your plan is active, not the day you pay/);
    expect(terms).toMatch(/Monday 00:00 to Friday 24:00, India time/);
    expect(terms).toMatch(/not for resale, and not for automated bulk runs/);
    expect(terms).toMatch(/We promise no reach, views or income/);
    expect(terms).toMatch(/scoped with you and quoted before it starts/);
    expect(terms).toContain('A Mac with Apple silicon on macOS 14 or later');
  });

  it('says when a payment is refunded and how a plan stops', () => {
    const refunds = said('premium-refunds');
    expect(refunds).toMatch(
      /If your plan is not active 7 days after your payment, we refund that payment in full/,
    );
    expect(refunds).toMatch(/Once your plan is active, a paid month is not refunded/);
    expect(refunds).toMatch(/You stop by not paying the next month’s payment link/);
    expect(refunds).toContain(`mailto:${SITE.email}`);
  });

  it('says what an order holds, who sees the card and how long it is kept', () => {
    const privacy = said('premium', PRIVACY);
    for (const kept of [
      'Your name, your email address and your WhatsApp number',
      'your channel, if you gave it',
      'the country the order came from',
      'the payment’s reference numbers',
    ]) {
      expect(privacy, kept).toContain(kept);
    }
    // What the payment provider gets from us, said plainly; the card is typed on its page.
    expect(privacy).toContain(
      'To make your payment page, our billing service gives our payment provider your name, your email address and your phone number. You type your card details on its page, and we never see them.',
    );
    // The number is required now, so nothing reads as if it were a choice.
    expect(privacy).toContain('We use your WhatsApp number to book your setup session and for support.');
    expect(privacy).not.toMatch(/if you gave them|If you give/);
    expect(privacy).toMatch(/An order that is never paid is deleted within 30 days/);
    expect(privacy).toMatch(/A paid order is kept for as long as tax and accounting law requires/);
    expect(privacy).toMatch(
      /Premium sends the material a make needs to cloud models, which model providers run for us/,
    );
    // What limits abuse, said as it is: a count against a scrambled network address, deleted within two days.
    expect(privacy).toContain(
      'To limit abuse, our billing service counts orders against a scrambled form of the network address a request came from. The address itself is not stored, and the count is deleted within two days.',
    );
    // The messages a buyer gets: one email from the billing service's send-only address, and the provider's receipt.
    expect(privacy).toContain(
      `One email from us, sent from premium@taalcut.app under the name Taalcut, saying your payment is in and what happens next. That address only sends: replies go to [${SITE.email}](mailto:${SITE.email}). Our payment provider sends its own receipt.`,
    );
    // A confirmed payment's outcome is kept for the tab, and the notice names the key with the site's other records.
    expect(privacy).toMatch(
      /the page keeps the outcome in your browser until you close the tab, so a reload still shows it/,
    );
    const stored = said('by-default', PRIVACY);
    expect(stored).toContain('The site also keeps four small records of its own in your browser’s storage.');
    expect(stored).toContain(`\`${OUTCOME_KEY}\`, in session storage`);
    expect(OUTCOME_KEY).toBe('taalcut.premiumOrder');
    expect(PRIVACY_GIST.rows.map((row) => row.section)).toContain('premium');
    expect(said('processors', PRIVACY)).toContain(PRIVACY_PREMIUM_PROCESSORS);
    expect(said('where', PRIVACY)).toContain(PRIVACY_PREMIUM_WHERE);
  });

  it('carries today’s date on both', () => {
    expect(TERMS.status).toBe('Last updated 14 November 2026.');
    expect(PRIVACY.status).toBe('Last updated 14 November 2026.');
  });
});
