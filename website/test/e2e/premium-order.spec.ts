// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';
import {
  CHECKOUT,
  LAUNCH,
  LIST,
  PAY_URL,
  fillOrder,
  mockCheckout,
  mockPayPage,
  mockQuote,
  orderForm,
  orderSection,
} from './premium-helpers';

/**
 * /premium/'s order form, with the billing service mocked: the order it sends (the amount the page showed goes with
 * it), the top-level navigation to the payment page, and one visitor sentence for each way the service can refuse. A
 * price that moved is shown and asked about again: the form never sends twice by itself. The form's own checks, field
 * by field, are in premium-fields.spec.ts.
 */

test.use({ timezoneId: 'Asia/Kolkata', locale: 'en-GB', reducedMotion: 'reduce' });

const button = (page: Page) => orderForm(page).locator('button[type="submit"]');
const notice = (page: Page) => orderForm(page).getByRole('alert');
const price = (page: Page) => orderSection(page).locator('[data-slot="price-amount"]');
const sent = (request: { postData(): string | null }) =>
  JSON.parse(request.postData() ?? 'null') as Record<string, unknown>;

async function openForm(page: Page, quote: unknown = LAUNCH, path = '/premium/?ref=producthunt') {
  const quotes = await mockQuote(page, { body: quote });
  await page.goto(path);
  await expect.poll(() => quotes.length).toBe(1);
  await expect(orderForm(page)).toBeVisible();
}

test('an order sends what the form holds with the amount the page showed, then the browser goes to the payment page', async ({
  page,
}) => {
  await openForm(page);
  const orders = await mockCheckout(page);
  await mockPayPage(page);
  await fillOrder(page, { whatsapp: '+1 (415) 555-0100', channel: 'instagram.com/asha' });
  await button(page).click();
  await page.waitForURL(PAY_URL);
  await expect(page.getByRole('heading', { name: 'Payment page' })).toBeVisible();
  expect(orders).toHaveLength(1);
  expect(orders[0]!.method()).toBe('POST');
  expect(new URL(orders[0]!.url()).pathname).toMatch(/\/v1\/checkout$/);
  expect(orders[0]!.headers()['content-type']).toBe('application/json');
  expect(sent(orders[0]!)).toEqual({
    plan: 'premium',
    ref: 'producthunt',
    name: 'Asha Rao',
    email: 'asha@example.com',
    whatsapp: '+14155550100',
    channel: 'https://instagram.com/asha',
    agreed: true,
    currency: 'USD',
    expect: 33900,
  });
});

test('at the list price, with only what is required, the order carries no tag and no empty field', async ({
  page,
}) => {
  await openForm(page, LIST, '/premium/');
  const orders = await mockCheckout(page, { status: 201, body: { ...CHECKOUT, amount: 40000 } });
  await mockPayPage(page);
  await fillOrder(page);
  await page.keyboard.press('Enter');
  await page.waitForURL(PAY_URL);
  expect(sent(orders[0]!)).toEqual({
    plan: 'premium',
    name: 'Asha Rao',
    email: 'asha@example.com',
    whatsapp: '+14155550100',
    agreed: true,
    currency: 'USD',
    expect: 40000,
  });
});

test('a price that changed is shown and asked about again; only the second press sends the new amount', async ({
  page,
}) => {
  await openForm(page);
  const orders = await mockCheckout(page, (_request, nth) =>
    nth === 1
      ? { status: 409, body: { code: 'billing.price_changed', quote: LIST } }
      : { status: 201, body: { ...CHECKOUT, amount: 40000 } },
  );
  await mockPayPage(page);
  await expect(price(page)).toHaveText('$339');
  await fillOrder(page);
  await button(page).click();
  await expect(notice(page)).toHaveText(
    'The price changed while this page was open. Check the new price, then continue.',
  );
  await expect(price(page)).toHaveText('$400');
  await expect(orderSection(page).locator('[data-slot="price-list"]')).toHaveCount(0);
  // Nothing was sent a second time, and the browser is still here, with the form as it was.
  expect(orders).toHaveLength(1);
  expect(sent(orders[0]!).expect).toBe(33900);
  await expect(page).toHaveURL(/\/premium\//);
  await expect(orderForm(page).getByLabel('Your name')).toHaveValue('Asha Rao');
  await expect(notice(page).getByRole('button')).toHaveCount(0);
  await button(page).click();
  await page.waitForURL(PAY_URL);
  expect(orders).toHaveLength(2);
  expect(sent(orders[1]!).expect).toBe(40000);
});

const REFUSALS: readonly (readonly [
  name: string,
  reply: { status: number; body: unknown } | null,
  words: string,
  retry: boolean,
])[] = [
  [
    'an order it can’t read',
    { status: 400, body: { code: 'billing.invalid', problems: [{ path: 'expect', rule: 'format' }] } },
    'The order didn’t pass our check. Look at each field.',
    false,
  ],
  [
    'a page that is out of date',
    { status: 404, body: { code: 'billing.not_found' } },
    'This page is out of date. Reload it.',
    false,
  ],
  [
    'too many tries, with a wait',
    { status: 429, body: { code: 'billing.rate_limited', retryAfterSeconds: 90 } },
    'Too many tries from here. Try again in 2 minutes, or write to admin@matterwardlabs.com.',
    false,
  ],
  [
    // A caller's daily allowance: the wait is hours, and the line says so instead of promising a short one.
    'too many tries, with a wait of hours',
    { status: 429, body: { code: 'billing.rate_limited', retryAfterSeconds: 18000 } },
    'Too many tries from here. Try again in 5 hours, or write to admin@matterwardlabs.com.',
    false,
  ],
  [
    'too many tries, without one',
    { status: 429, body: { code: 'billing.rate_limited' } },
    'Too many tries from here. Try again later, or write to admin@matterwardlabs.com.',
    false,
  ],
  [
    'a fault of ours',
    { status: 500, body: { code: 'billing.busy' } },
    'Our side had a problem. Nothing was charged.',
    true,
  ],
  [
    'a payment provider that didn’t answer',
    { status: 502, body: { code: 'billing.provider_unavailable' } },
    'Our payment provider didn’t answer. Nothing was charged.',
    true,
  ],
  [
    'an answer of the wrong shape',
    { status: 201, body: { ...CHECKOUT, payUrl: 'http://pay.example/l/abc123' } },
    'Something unexpected came back. Nothing was charged.',
    true,
  ],
  [
    'a refusal it doesn’t name',
    { status: 500, body: '<html>Internal error</html>' },
    'Something unexpected came back. Nothing was charged.',
    true,
  ],
  ['a service out of reach', null, 'We couldn’t reach our billing service. Nothing was charged.', true],
];

for (const [name, reply, words, retry] of REFUSALS) {
  test(`checkout refused: ${name}`, async ({ page }) => {
    await openForm(page);
    const orders = await mockCheckout(page, (_request, nth) =>
      nth === 1 ? reply : { status: 201, body: CHECKOUT },
    );
    await mockPayPage(page);
    await fillOrder(page);
    await button(page).click();
    await expect(notice(page)).toContainText(words);
    await expect(page).toHaveURL(/\/premium\//);
    await expect(button(page)).toHaveText('Continue to payment');
    await expect(button(page)).not.toHaveAttribute('aria-busy', 'true');
    // What was typed is still there.
    await expect(orderForm(page).getByLabel('Your email')).toHaveValue('asha@example.com');
    expect(orders).toHaveLength(1);
    const again = notice(page).getByRole('button', { name: 'Try again' });
    await expect(again).toHaveCount(retry ? 1 : 0);
    if (retry) {
      await again.click();
      await page.waitForURL(PAY_URL);
      expect(orders).toHaveLength(2);
    }
  });
}

test('checkout refused field by field: the problem sits on the field the service named', async ({ page }) => {
  await openForm(page);
  const orders = await mockCheckout(page, {
    status: 400,
    body: {
      code: 'billing.invalid',
      problems: [
        { path: 'channel', rule: 'format' },
        { path: 'email', rule: 'format' },
      ],
    },
  });
  await fillOrder(page, { channel: 'instagram.com/asha' });
  await button(page).click();
  const form = orderForm(page);
  await expect(form.getByLabel('Your email')).toBeFocused();
  await expect(form.getByLabel('Your email')).toHaveAccessibleDescription(
    'Our check didn’t accept this. Look at it again.',
  );
  await expect(form.getByLabel('Your channel')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByLabel('Your name')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(notice(page)).toHaveCount(0);
  expect(orders).toHaveLength(1);
});

for (const [name, reply] of [
  ['orders were switched off', { status: 503, body: { code: 'billing.not_selling' } }],
  // The service takes orders from the website's own pages only; trying again can't help, so the address takes over.
  ['the service refuses this page', { status: 403, body: { code: 'billing.forbidden' } }],
] as const) {
  test(`checkout refused because ${name}: the form gives way to the address`, async ({ page }) => {
    await openForm(page);
    const orders = await mockCheckout(page, reply);
    await fillOrder(page);
    await button(page).click();
    const closed = orderSection(page).locator('[data-slot="order-closed"]');
    await expect(closed).toHaveText(
      'We can’t take orders on this page right now. Write to admin@matterwardlabs.com and we send you a payment link.',
    );
    await expect(closed.getByRole('link', { name: 'admin@matterwardlabs.com' })).toHaveAttribute(
      'href',
      'mailto:admin@matterwardlabs.com',
    );
    await expect(orderForm(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/premium\//);
    expect(orders).toHaveLength(1);
  });
}

test('a refusal that names the address carries it as a link', async ({ page }) => {
  await openForm(page);
  await mockCheckout(page, { status: 429, body: { code: 'billing.rate_limited', retryAfterSeconds: 18000 } });
  await fillOrder(page);
  await button(page).click();
  await expect(notice(page).getByRole('link', { name: 'admin@matterwardlabs.com' })).toHaveAttribute(
    'href',
    'mailto:admin@matterwardlabs.com',
  );
  await expect(notice(page)).not.toContainText(/a moment|a minute/);
});

test('offline, the form says so and sends nothing further', async ({ page, context }) => {
  await openForm(page);
  await fillOrder(page);
  await context.setOffline(true);
  await button(page).click();
  await expect(notice(page)).toContainText('You’re offline. Nothing was sent.');
  await expect(notice(page).getByRole('button', { name: 'Try again' })).toBeVisible();
  await context.setOffline(false);
});

test('while the price is still being checked, a send waits for it and then carries the quoted amount', async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/quote?*', async (route) => {
    await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(LAUNCH) });
  });
  const orders = await mockCheckout(page);
  await mockPayPage(page);
  await page.goto('/premium/?ref=producthunt');
  await fillOrder(page);
  await button(page).click();
  await expect(button(page)).toHaveText('Checking the price…');
  await expect(button(page)).toHaveAttribute('aria-busy', 'true');
  expect(orders).toHaveLength(0);
  release();
  await page.waitForURL(PAY_URL);
  expect(sent(orders[0]!).expect).toBe(33900);
});

test('a second press while an order is on its way sends nothing more', async ({ page }) => {
  await openForm(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route('**/v1/checkout', async (route) => {
    posts += 1;
    await held;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(CHECKOUT) });
  });
  await mockPayPage(page);
  await fillOrder(page);
  await button(page).click();
  await expect(button(page)).toHaveText('Opening the payment page…');
  await expect(orderForm(page).getByLabel('Your name')).toHaveAttribute('readonly', '');
  await button(page).click({ force: true });
  await page.keyboard.press('Enter');
  expect(posts).toBe(1);
  release();
  await page.waitForURL(PAY_URL);
  expect(posts).toBe(1);
});
