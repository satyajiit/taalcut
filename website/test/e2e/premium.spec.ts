// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test } from '@playwright/test';
import { LAUNCH, LIST, mockQuote, orderForm, orderSection, priceCard } from './premium-helpers';

/**
 * /premium/: the price the page shows. The list price is in the server HTML; the page then asks the billing service
 * for a quote (mocked here) with the tag the visit arrived with, and shows what it says: the list price, a launch
 * price with the list price struck through and the moment it ends, or, when orders are off or the service is out of
 * reach, one sentence and the address in place of the form. Sending an order is in premium-order.spec.ts.
 */

test.use({ timezoneId: 'Asia/Kolkata', locale: 'en-GB', reducedMotion: 'reduce' });

const amount = (scope: ReturnType<typeof priceCard>) => scope.locator('[data-slot="price-amount"]');

test('the server HTML carries the list price, every section and two structured-data offers: 400 US dollars a month, and 37,600 rupees in India', async ({
  request,
}) => {
  const html = await (await request.get('/premium/')).text();
  expect(html).toContain('$400');
  expect(html).not.toMatch(/\$339|33900/);
  for (const words of [
    'What you get',
    'From payment to active',
    'Before you order',
    'Questions about Premium',
    'Order Premium',
    'Is Taalcut still free?',
  ]) {
    expect(html, words).toContain(words);
  }
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(
    (m) => {
      const parsed = JSON.parse(m[1]!) as unknown;
      return (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
    },
  );
  const service = blocks.find((block) => block['@type'] === 'Service');
  expect(service).toMatchObject({
    name: 'Taalcut Premium',
    offers: [
      { '@type': 'Offer', price: '400.00', priceCurrency: 'USD' },
      { '@type': 'Offer', price: '37600.00', priceCurrency: 'INR', eligibleRegion: { name: 'India' } },
    ],
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the page reads whole: the list price, the plan, and the address where the form would be', async ({
    page,
  }) => {
    await page.goto('/premium/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Taalcut Premium. Set up for you, on the top models.',
    );
    await expect(amount(priceCard(page))).toHaveText('$400');
    await expect(priceCard(page)).toContainText('a month');
    // The form can't send without a script, so it hides; one sentence with the address stands in its place. It waits in
    // a <noscript> (Playwright's no-JS mode still parses that as text, so read the served HTML).
    const html = await (await page.request.get('/premium/')).text();
    const still = html.match(/<noscript>(.*?)<\/noscript>/gs)?.join('') ?? '';
    expect(still).toMatch(
      /The order form needs JavaScript\. You can also write to <a [^>]*href="mailto:admin@matterwardlabs\.com"/,
    );
    expect(still).toContain('form[data-slot="order-form"]{display:none!important}');
    await expect(
      orderSection(page).getByRole('link', { name: 'admin@matterwardlabs.com' }).first(),
    ).toHaveAttribute('href', 'mailto:admin@matterwardlabs.com');
    await expect(page.getByRole('link', { name: 'Order Premium' })).toHaveAttribute('href', '#order');
  });
});

test('a quote at the list price shows $400 a month, in the plan card and beside the form', async ({
  page,
}) => {
  const quotes = await mockQuote(page, { body: LIST });
  await page.goto('/premium/');
  await expect(orderForm(page)).toBeVisible();
  await expect.poll(() => quotes.length).toBe(1);
  const asked = new URL(quotes[0]!.url());
  expect(asked.pathname).toMatch(/\/v1\/quote$/);
  expect(asked.searchParams.get('plan')).toBe('premium');
  expect(asked.searchParams.has('ref')).toBe(false);
  expect(quotes[0]!.method()).toBe('GET');
  for (const scope of [priceCard(page), orderSection(page)]) {
    await expect(amount(scope)).toHaveText('$400');
    await expect(scope.locator('[data-slot="premium-price"]')).toContainText('a month');
    await expect(scope.locator('[data-slot="price-list"]')).toHaveCount(0);
    await expect(scope.locator('[data-slot="price-offer"]')).toHaveCount(0);
  }
  // The header marks the page, and the page has one h1.
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Premium', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});

test('a quote with a launch price shows it, the list price struck through and the moment it ends', async ({
  page,
}) => {
  const quotes = await mockQuote(page, { body: LAUNCH });
  await page.goto('/premium/?ref=producthunt');
  await expect.poll(() => quotes.length).toBe(1);
  expect(new URL(quotes[0]!.url()).searchParams.get('ref')).toBe('producthunt');
  for (const scope of [priceCard(page), orderSection(page)]) {
    const price = scope.locator('[data-slot="premium-price"]');
    await expect(price).toHaveAttribute('data-offer', 'product-hunt');
    await expect(amount(scope)).toHaveText('$339');
    const struck = scope.locator('[data-slot="price-list"]');
    await expect(struck).toHaveText('List price $400');
    expect(await struck.evaluate((el) => el.tagName)).toBe('S');
    await expect(price).toContainText('for your first month');
    // The end is said in the visitor's own time zone, with the zone named.
    await expect(scope.locator('[data-slot="price-offer"]')).toHaveText(
      /^Product Hunt launch price, until 26 November at 13:31 (IST|GMT\+5:30)\. Later months are \$400 a month\.$/,
    );
  }
  // The price about to be charged is a live region beside the form: a change is said, not only shown.
  await expect(orderSection(page).locator('[data-slot="premium-price"]')).toHaveAttribute(
    'aria-live',
    'polite',
  );
});

test('an offer the site has no name for reads as a launch price', async ({ page }) => {
  await mockQuote(page, {
    body: { ...LAUNCH, amount: 35000, offer: { id: 'spring-2027', endsAt: '2027-03-01T00:00:00.000Z' } },
  });
  await page.goto('/premium/');
  await expect(amount(priceCard(page))).toHaveText('$350');
  await expect(priceCard(page).locator('[data-slot="price-offer"]')).toContainText(
    /^Launch price, until 1 March at 05:30/,
  );
});

test('the tag a visit arrived with rides on every link to /premium/, so the page, a reload and a new tab all ask with it', async ({
  page,
  context,
}) => {
  const quotes = await mockQuote(page, { body: LAUNCH });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?ref=producthunt');
  // Nothing is asked of the billing service until the visitor is on /premium/.
  expect(quotes).toHaveLength(0);
  const tagged = '/premium/?ref=producthunt';
  const nav = page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Premium', exact: true });
  await expect(nav).toHaveAttribute('href', tagged);
  await expect(
    page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'Premium', exact: true }),
  ).toHaveAttribute('href', tagged);
  await expect(
    page.locator('[data-slot="premium-pointer"]').getByRole('link', { name: 'Taalcut Premium' }),
  ).toHaveAttribute('href', tagged);
  // Every other link is as written.
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Features', exact: true }),
  ).toHaveAttribute('href', '/features/');
  // Following it lands on the tagged address: the page reads its own `?ref=`.
  await nav.click();
  await expect(page).toHaveURL(/\/premium\/\?ref=producthunt$/);
  await expect.poll(() => quotes.length).toBe(1);
  expect(new URL(quotes[0]!.url()).searchParams.get('ref')).toBe('producthunt');
  await expect(amount(priceCard(page))).toHaveText('$339');
  // A reload keeps it, with nothing stored.
  await page.reload();
  await expect.poll(() => quotes.length).toBe(2);
  expect(new URL(quotes[1]!.url()).searchParams.get('ref')).toBe('producthunt');
  // The tag is in the address and in memory only: nothing the browser stores holds it.
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...window.localStorage }, { ...window.sessionStorage }]),
  );
  expect(stored).not.toContain('producthunt');
  // A new tab opened from the link's address keeps it too.
  const other = await context.newPage();
  const asked = await mockQuote(other, { body: LAUNCH });
  await other.goto(tagged);
  await expect.poll(() => asked.length).toBe(1);
  expect(new URL(asked[0]!.url()).searchParams.get('ref')).toBe('producthunt');
  await other.close();
});

test('the tag rides on the links of /download/, the terms and the phone’s menu too', async ({ page }) => {
  await mockQuote(page, { body: LAUNCH });
  const tagged = '/premium/?ref=producthunt';
  await page.goto('/download/?ref=producthunt');
  await expect(
    page.locator('[data-slot="premium-pointer"]').getByRole('link', { name: 'Taalcut Premium' }),
  ).toHaveAttribute('href', tagged);
  await page.goto('/terms/?ref=producthunt');
  await expect(page.locator('#premium').getByRole('link', { name: 'Premium page' }).first()).toHaveAttribute(
    'href',
    tagged,
  );
  await expect(page.locator('#premium').getByRole('link', { name: 'Premium page' }).nth(1)).toHaveAttribute(
    'href',
    '/premium/?ref=producthunt#included',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/faq/?ref=producthunt');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.locator('#site-menu').getByRole('link', { name: 'Premium' })).toHaveAttribute(
    'href',
    tagged,
  );
});

test('only a plain code is ever put into an href', async ({ page }) => {
  for (const typed of [
    '%3Cscript%3Ealert(1)%3C/script%3E',
    '%22%3E%3Cimg%20src=x%3E',
    'a%20b',
    'x'.repeat(41),
    'a%26b%3Dc',
  ]) {
    await page.goto(`/download/?ref=${typed}`);
    await expect(
      page.locator('[data-slot="premium-pointer"]').getByRole('link', { name: 'Taalcut Premium' }),
    ).toHaveAttribute('href', '/premium/');
    const hrefs = await page
      .locator('a[href^="/premium/"]')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const href of hrefs) expect(href, typed).toBe('/premium/');
  }
  // A code in capitals is written as the billing service reads it.
  await page.goto('/download/?ref=ProductHunt');
  await expect(
    page.locator('[data-slot="premium-pointer"]').getByRole('link', { name: 'Taalcut Premium' }),
  ).toHaveAttribute('href', '/premium/?ref=producthunt');
});

test('a tag that could not be a code is never sent', async ({ page }) => {
  const quotes = await mockQuote(page, { body: LIST });
  await page.goto('/premium/?ref=%3Cscript%3E');
  await expect.poll(() => quotes.length).toBe(1);
  expect(new URL(quotes[0]!.url()).searchParams.has('ref')).toBe(false);
});

const CLOSED =
  'We can’t take orders on this page right now. Write to admin@matterwardlabs.com and we send you a payment link.';

for (const [name, reply] of [
  ['the billing service says it isn’t selling', { body: { ...LIST, selling: false } }],
  ['the billing service can’t be reached', null],
  [
    'the billing service answers with an error',
    { status: 502, body: { code: 'billing.provider_unavailable' } },
  ],
  [
    'the billing service limits the visitor',
    { status: 429, body: { code: 'billing.rate_limited', retryAfterSeconds: 18000 } },
  ],
  ['the billing service refuses this page', { status: 403, body: { code: 'billing.forbidden' } }],
  ['the answer isn’t a quote', { body: { plan: 'premium', price: 'free' } }],
  ['the answer isn’t JSON', { body: '<html>Not found</html>', status: 404 }],
  ['the quote is for another plan', { body: { ...LIST, plan: 'studio' } }],
] as const) {
  test(`when ${name}, the form gives way to one sentence and the address, and the list price stays`, async ({
    page,
  }) => {
    await mockQuote(page, reply);
    await page.goto('/premium/');
    const closed = orderSection(page).locator('[data-slot="order-closed"]');
    await expect(closed).toHaveText(CLOSED);
    await expect(closed.getByRole('link', { name: 'admin@matterwardlabs.com' })).toHaveAttribute(
      'href',
      'mailto:admin@matterwardlabs.com',
    );
    await expect(orderForm(page)).toHaveCount(0);
    await expect(orderSection(page).locator('button[type="submit"]')).toHaveCount(0);
    await expect(amount(priceCard(page))).toHaveText('$400');
    await expect(amount(orderSection(page))).toHaveText('$400');
    // No quote, so no currency to change.
    await expect(orderSection(page).locator('[data-slot="price-currency"]')).toHaveCount(0);
  });
}

test('the page says what it must before an order: what it needs, where material goes, and what it is paid in', async ({
  page,
}) => {
  await mockQuote(page);
  await page.goto('/premium/');
  const main = page.locator('main');
  for (const words of [
    'A Mac with Apple silicon on macOS 14 or later, the same as the app.',
    'Premium sends the material a make needs to cloud models, which model providers run for us. The free app’s on-device mode is unchanged.',
    'not for resale, and not for automated bulk runs',
    'Nobody can promise reach, views or income, and we don’t.',
    'Work beyond your plan is scoped with you and quoted before it starts.',
    'Within one business day we write to you',
    'Your plan is active within 7 days of payment, and your paid month starts that day.',
    'In US dollars, or in Indian rupees in India, month to month, by one payment link a month.',
  ]) {
    await expect(main, words).toContainText(words);
  }
  // Buyers in India pay in rupees on the page itself: nothing sends a card from India to the address.
  await expect(main).not.toContainText(/card issued in India/i);
  // Never a stage of something, and no stack name.
  await expect(main).not.toContainText(
    /\b(trial|pilot|beta|early bird|waitlist|experiment|razorpay|stripe)\b/i,
  );
  // The terms open in a new tab, so reading them keeps what the form holds.
  const form = orderForm(page);
  await expect(form.getByRole('link', { name: 'Premium terms' })).toHaveAttribute('href', '/terms/#premium');
  await expect(form.getByRole('link', { name: 'refund and cancellation terms' })).toHaveAttribute(
    'href',
    '/terms/#premium-refunds',
  );
  await expect(form.getByRole('link', { name: 'Premium terms' })).toHaveAttribute('target', '_blank');
  await expect(form.getByRole('link', { name: 'privacy notice' })).toHaveAttribute(
    'href',
    '/privacy/#premium',
  );
});

test('a question opens and closes with the keyboard, and Order Premium leads to the form', async ({
  page,
}) => {
  await mockQuote(page);
  await page.goto('/premium/');
  const question = page.locator('details[data-question="refunds"]');
  await question.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(question).toHaveAttribute('open', '');
  await expect(question).toContainText(
    'If your plan isn’t active 7 days after you paid, we refund you in full.',
  );
  await page.keyboard.press('Enter');
  await expect(question).not.toHaveAttribute('open', '');
  await priceCard(page).getByRole('link', { name: 'Order Premium' }).click();
  await expect(page).toHaveURL(/#order$/);
  await expect(orderForm(page)).toBeInViewport();
});

test('the terms and the privacy notice have the sections the form links to', async ({ page }) => {
  await page.goto('/terms/');
  await expect(page.locator('#premium')).toContainText('Taalcut Premium');
  await expect(page.locator('#premium-refunds')).toContainText(
    'If your plan is not active 7 days after your payment, we refund that payment in full.',
  );
  await page.goto('/privacy/');
  await expect(page.locator('#premium')).toContainText(
    'An order that is never paid is deleted within 30 days.',
  );
  await expect(page.locator('#premium')).toContainText(
    'To make your payment page, our billing service gives our payment provider your name, your email address and your phone number. You type your card details on its page, and we never see them.',
  );
});

test('other pages lead to Premium: the home’s cost section, /download/ and the FAQ', async ({ page }) => {
  await page.goto('/');
  const pointer = page.locator('#cost [data-slot="premium-pointer"], [data-slot="premium-pointer"]').first();
  await expect(pointer).toContainText('Would you rather we set it up and pay for the models?');
  await expect(pointer.getByRole('link', { name: 'Taalcut Premium' })).toHaveAttribute('href', '/premium/');
  await page.goto('/download/');
  const line = page.locator('[data-slot="premium-pointer"]');
  await expect(line).toHaveText(
    'Want it installed and set up for you, on the top models? Taalcut Premium is $400 a month, or ₹37,600 a month in India.',
  );
  await expect(line.getByRole('link', { name: 'Taalcut Premium' })).toHaveAttribute('href', '/premium/');
  await page.goto('/faq/');
  await expect(page.locator('main')).toContainText('Is Taalcut still free?');
  await expect(page.locator('main')).toContainText('What is Premium?');
});
