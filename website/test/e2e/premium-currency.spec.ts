// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';
import {
  CHECKOUT,
  LIST,
  LIST_INR,
  PAID,
  PAY_URL,
  RETURN_QUERY,
  askedIn,
  fillOrder,
  mockCheckout,
  mockConfirm,
  mockPayPage,
  mockQuote,
  orderForm,
  orderSection,
  priceCard,
  quotesFor,
  thanks,
} from './premium-helpers';

/**
 * Premium in two currencies, with the billing service mocked: Indian rupees for a visitor in India, US dollars
 * elsewhere (the service picks; the page asks with `currency=auto`). Everything that shows the quoted price follows
 * the quote's currency, one quiet line under the order's price changes it, and the order carries the one shown.
 */

test.use({ timezoneId: 'Asia/Kolkata', locale: 'en-GB', reducedMotion: 'reduce' });

const amount = (scope: ReturnType<Page['locator']>) => scope.locator('[data-slot="price-amount"]');
const line = (page: Page) => orderSection(page).locator('[data-slot="price-currency"]');
const button = (page: Page) => orderForm(page).locator('button[type="submit"]');
const sent = (request: { postData(): string | null }) =>
  JSON.parse(request.postData() ?? 'null') as Record<string, unknown>;

test('the page asks for the visitor’s own currency, and a visitor in India sees rupees wherever the price is', async ({
  page,
}) => {
  const quotes = await mockQuote(page, quotesFor('INR'));
  await page.goto('/premium/');
  await expect.poll(() => quotes.length).toBe(1);
  // The first question names no currency of its own: the service picks from the country the request comes from.
  expect(askedIn(quotes[0]!)).toBe('auto');
  for (const scope of [priceCard(page), orderSection(page)]) {
    await expect(amount(scope)).toHaveText('₹37,600');
    await expect(scope.locator('[data-slot="premium-price"]')).toContainText('a month');
    await expect(scope.locator('[data-slot="premium-price"]')).not.toContainText('$');
  }
  await expect(line(page)).toHaveText('Prices in Indian rupees. Pay in US dollars instead');
  await expect(line(page)).toHaveAttribute('data-currency', 'INR');
  // One switch, where the order's price is: the plan card above only follows it.
  await expect(page.locator('[data-slot="price-currency"]')).toHaveCount(1);
});

test('a launch price in rupees: the price, the struck list price and the later months are all in rupees', async ({
  page,
}) => {
  await mockQuote(page, quotesFor('INR', true));
  await page.goto('/premium/?ref=producthunt');
  for (const scope of [priceCard(page), orderSection(page)]) {
    await expect(amount(scope)).toHaveText('₹31,866');
    await expect(scope.locator('[data-slot="price-list"]')).toHaveText('List price ₹37,600');
    await expect(scope.locator('[data-slot="premium-price"]')).toContainText('for your first month');
    await expect(scope.locator('[data-slot="price-offer"]')).toHaveText(
      /^Product Hunt launch price, until 26 November at 13:31 (IST|GMT\+5:30)\. Later months are ₹37,600 a month\.$/,
    );
  }
  await expect(page.locator('main [data-slot="premium-price"]').first()).not.toContainText('$');
});

test('a visitor elsewhere sees dollars, and the same line offers rupees', async ({ page }) => {
  await mockQuote(page, quotesFor('USD', true));
  await page.goto('/premium/?ref=producthunt');
  await expect(amount(orderSection(page))).toHaveText('$339');
  await expect(line(page)).toHaveText('Prices in US dollars. Pay in Indian rupees instead');
});

test('the switch asks the service for the other currency, both ways, and the plan card follows', async ({
  page,
}) => {
  const quotes = await mockQuote(page, quotesFor('INR', true));
  await page.goto('/premium/?ref=producthunt');
  await expect(amount(orderSection(page))).toHaveText('₹31,866');
  const change = line(page).getByRole('button');
  await change.click();
  await expect(line(page)).toHaveText('Prices in US dollars. Pay in Indian rupees instead');
  // The page didn't convert anything: it asked, with the visit's tag, and shows what came back.
  expect(quotes).toHaveLength(2);
  expect(askedIn(quotes[1]!)).toBe('USD');
  expect(new URL(quotes[1]!.url()).searchParams.get('ref')).toBe('producthunt');
  for (const scope of [priceCard(page), orderSection(page)]) {
    await expect(amount(scope)).toHaveText('$339');
    await expect(scope.locator('[data-slot="price-list"]')).toHaveText('List price $400');
    await expect(scope.locator('[data-slot="price-offer"]')).toContainText('Later months are $400 a month.');
  }
  // The button kept its place and its focus, so the keyboard can turn it back.
  await expect(change).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(line(page)).toHaveText('Prices in Indian rupees. Pay in US dollars instead');
  expect(askedIn(quotes[2]!)).toBe('INR');
  await expect(amount(priceCard(page))).toHaveText('₹31,866');
  await expect(change).toBeFocused();
});

test('an order in rupees carries the currency and the amount the page showed', async ({ page }) => {
  await mockQuote(page, quotesFor('INR', true));
  const orders = await mockCheckout(page, {
    status: 201,
    body: { ...CHECKOUT, currency: 'INR', amount: 3186600 },
  });
  await mockPayPage(page);
  await page.goto('/premium/?ref=producthunt');
  await expect(amount(orderSection(page))).toHaveText('₹31,866');
  await fillOrder(page, { whatsapp: '+91 98765 43210' });
  await button(page).click();
  await page.waitForURL(PAY_URL);
  expect(sent(orders[0]!)).toEqual({
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

test('after the switch, the order carries the chosen currency: never `auto`, never the first one', async ({
  page,
}) => {
  await mockQuote(page, quotesFor('INR'));
  const orders = await mockCheckout(page, { status: 201, body: { ...CHECKOUT, amount: 40000 } });
  await mockPayPage(page);
  await page.goto('/premium/');
  await line(page).getByRole('button', { name: 'Pay in US dollars instead' }).click();
  await expect(amount(orderSection(page))).toHaveText('$400');
  await fillOrder(page);
  await button(page).click();
  await page.waitForURL(PAY_URL);
  expect(sent(orders[0]!)).toMatchObject({ currency: 'USD', expect: 40000 });
});

test('a price that changed comes back in the order’s own currency and is shown in it', async ({ page }) => {
  await mockQuote(page, quotesFor('INR', true));
  const orders = await mockCheckout(page, (_request, nth) =>
    nth === 1
      ? { status: 409, body: { code: 'billing.price_changed', quote: LIST_INR } }
      : { status: 201, body: { ...CHECKOUT, currency: 'INR', amount: 3760000 } },
  );
  await mockPayPage(page);
  await page.goto('/premium/?ref=producthunt');
  await fillOrder(page);
  await button(page).click();
  await expect(orderForm(page).getByRole('alert')).toContainText(
    'The price changed while this page was open.',
  );
  await expect(amount(orderSection(page))).toHaveText('₹37,600');
  await expect(orderSection(page).locator('[data-slot="price-list"]')).toHaveCount(0);
  await button(page).click();
  await page.waitForURL(PAY_URL);
  expect(sent(orders[1]!)).toMatchObject({ currency: 'INR', expect: 3760000 });
});

test('the choice lasts for the visit, in memory only: another page and back asks in it, a reload asks afresh', async ({
  page,
}) => {
  const quotes = await mockQuote(page, quotesFor('INR'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/premium/');
  await line(page).getByRole('button', { name: 'Pay in US dollars instead' }).click();
  await expect(amount(orderSection(page))).toHaveText('$400');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Features', exact: true }).click();
  await expect(page).toHaveURL(/\/features\/$/);
  await nav.getByRole('link', { name: 'Premium', exact: true }).click();
  await expect(amount(orderSection(page))).toHaveText('$400');
  expect(quotes.map(askedIn)).toEqual(['auto', 'USD', 'USD']);
  // Nothing the browser stores holds the choice.
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...window.localStorage }, { ...window.sessionStorage }]),
  );
  expect(stored).not.toMatch(/USD|INR/);
  await page.reload();
  await expect(amount(orderSection(page))).toHaveText('₹37,600');
  expect(askedIn(quotes[3]!)).toBe('auto');
});

for (const [name, body] of [
  ['lists no currencies', (({ currencies: _listed, ...older }) => older)(LIST)],
  ['lists only its own', { ...LIST_INR, currencies: ['INR'] }],
] as const) {
  test(`a quote that ${name} shows its price and no switch`, async ({ page }) => {
    await mockQuote(page, { body });
    await page.goto('/premium/');
    await expect(amount(orderSection(page))).toHaveText(body.currency === 'INR' ? '₹37,600' : '$400');
    await expect(orderForm(page)).toBeVisible();
    await expect(page.locator('[data-slot="price-currency"]')).toHaveCount(0);
  });
}

for (const [name, refusal] of [
  ['can’t give the other price', { status: 502, body: { code: 'billing.provider_unavailable' } }],
  [
    'doesn’t sell in that currency',
    { status: 400, body: { code: 'billing.invalid', problems: [{ path: 'currency', rule: 'unknown' }] } },
  ],
  ['answers in the wrong currency', { body: LIST_INR }],
] as const) {
  test(`when the service ${name}, the price shown stays and the line says so; trying again works`, async ({
    page,
  }) => {
    let refuse = true;
    const quotes = await mockQuote(page, (request) =>
      askedIn(request) === 'USD' ? (refuse ? refusal : { body: LIST }) : { body: LIST_INR },
    );
    await page.goto('/premium/');
    const change = line(page).getByRole('button', { name: 'Pay in US dollars instead' });
    await change.click();
    await expect(line(page)).toHaveAttribute('data-state', 'failed');
    await expect(line(page).getByRole('status')).toHaveText('We couldn’t get that price. Try again.');
    await expect(line(page)).toContainText('Prices in Indian rupees.');
    await expect(amount(orderSection(page))).toHaveText('₹37,600');
    await expect(orderForm(page)).toBeVisible();
    refuse = false;
    await change.click();
    await expect(amount(orderSection(page))).toHaveText('$400');
    await expect(line(page).getByRole('status')).toHaveText('');
    expect(quotes.map(askedIn)).toEqual(['auto', 'USD', 'USD']);
  });
}

test('while an order is on its way the currency can’t be changed', async ({ page }) => {
  const quotes = await mockQuote(page, quotesFor('INR'));
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/v1/checkout', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 });
    await held;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"billing.busy"}' });
  });
  await page.goto('/premium/');
  await expect(amount(orderSection(page))).toHaveText('₹37,600');
  await fillOrder(page);
  await button(page).click();
  const change = line(page).getByRole('button');
  await expect(change).toHaveAttribute('aria-disabled', 'true');
  // Pressed all the same (Playwright would otherwise wait for it to be enabled again).
  await change.click({ force: true });
  await expect(amount(orderSection(page))).toHaveText('₹37,600');
  release();
  await expect(orderForm(page).getByRole('alert')).toContainText('Our side had a problem.');
  await expect(change).not.toHaveAttribute('aria-disabled', 'true');
  // Nothing was asked meanwhile: the order out there carried rupees, and the page still shows them.
  expect(quotes).toHaveLength(1);
});

test('a payment in rupees is said in rupees on the thanks page', async ({ page }) => {
  await mockConfirm(page, { body: { ...PAID, currency: 'INR', amount: 3186600 } });
  await page.goto(`/premium/thanks/${RETURN_QUERY}`);
  await expect(thanks(page)).toHaveAttribute('data-state', 'paid');
  await expect(thanks(page)).toContainText('We have your payment of ₹31,866 for Taalcut Premium.');
  await expect(thanks(page)).not.toContainText('$');
  // A reload shows the same amount from the tab's own record.
  await page.reload();
  await expect(thanks(page)).toContainText('We have your payment of ₹31,866 for Taalcut Premium.');
});

test('the terms, the FAQ and /download/ say both prices, and the notice says how the currency is picked', async ({
  page,
}) => {
  await page.goto('/terms/');
  await expect(page.locator('#premium')).toContainText(
    '$400 a month, or ₹37,600 a month in India. The order page shows the price in Indian rupees to visitors in India and in US dollars elsewhere, and lets you choose the other. You pay the price shown; nothing is added on the payment page.',
  );
  await page.goto('/privacy/');
  await expect(page.locator('#premium')).toContainText(
    'Our billing service picks the currency the Premium page shows you from the country your request comes from.',
  );
  await page.goto('/faq/');
  await expect(page.locator('#premium-a')).toContainText('at $400 a month, or ₹37,600 a month in India.');
  await page.goto('/download/');
  await expect(page.locator('[data-slot="premium-pointer"]')).toContainText(
    'Taalcut Premium is $400 a month, or ₹37,600 a month in India.',
  );
});
