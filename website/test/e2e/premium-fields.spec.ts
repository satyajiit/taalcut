// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';
import {
  LAUNCH,
  PAY_URL,
  fillOrder,
  mockCheckout,
  mockPayPage,
  mockQuote,
  orderForm,
} from './premium-helpers';

/**
 * /premium/'s order form, field by field, with the billing service mocked: what is required, what each field says when
 * it is empty or wrong, and that nothing is sent while a problem stands. The checks are the billing service's own, so
 * a refusal shows beside the field before anything goes out.
 */

test.use({ timezoneId: 'Asia/Kolkata', locale: 'en-GB', reducedMotion: 'reduce' });

const button = (page: Page) => orderForm(page).locator('button[type="submit"]');
const sent = (request: { postData(): string | null }) =>
  JSON.parse(request.postData() ?? 'null') as Record<string, unknown>;

async function openForm(page: Page) {
  const quotes = await mockQuote(page, { body: LAUNCH });
  await page.goto('/premium/?ref=producthunt');
  await expect.poll(() => quotes.length).toBe(1);
  await expect(orderForm(page)).toBeVisible();
}

test('the form marks what is required, and says why it asks for a phone number', async ({ page }) => {
  await openForm(page);
  const form = orderForm(page);
  for (const label of ['Your name', 'Your email', 'WhatsApp number']) {
    await expect(form.getByLabel(label), label).toHaveAttribute('required', '');
    await expect(form.getByLabel(label), label).toHaveAttribute('aria-required', 'true');
  }
  await expect(form.getByRole('checkbox')).toHaveAttribute('required', '');
  await expect(form.getByLabel('Your channel')).not.toHaveAttribute('required', '');
  // Only the channel is tagged Optional; the number keeps its hint and gains the reason it is asked for.
  await expect(form.getByText('Optional', { exact: true })).toHaveCount(1);
  await expect(form.getByLabel('WhatsApp number')).toHaveAccessibleDescription(
    'With your country code, like +14155550100',
  );
  await expect(form).toContainText(
    'Our payment provider needs a phone number to make your payment page, and we use it to book your setup session and for support.',
  );
});

test('an empty form sends nothing: each problem sits on its field, and focus goes to the first', async ({
  page,
}) => {
  await openForm(page);
  const orders = await mockCheckout(page);
  await button(page).click();
  const form = orderForm(page);
  await expect(form.getByLabel('Your name')).toBeFocused();
  await expect(form.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByLabel('Your name')).toHaveAccessibleDescription(
    'Add your name, or what to call you.',
  );
  await expect(form.getByLabel('Your email')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByRole('checkbox')).toHaveAccessibleDescription('Tick the box to agree to the terms.');
  // The number is required, like the name and the email; the channel is fine empty.
  await expect(form.getByLabel('WhatsApp number')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByLabel('WhatsApp number')).toHaveAccessibleDescription(
    'Add your number, like +14155550100.',
  );
  await expect(form.getByLabel('Your channel')).not.toHaveAttribute('aria-invalid', 'true');
  // Each is wrong when filled with something that isn't one.
  await form.getByLabel('Your name').fill('Asha Rao');
  await expect(form.getByLabel('Your name')).not.toHaveAttribute('aria-invalid', 'true');
  await form.getByLabel('Your email').fill('asha@example.com');
  await form.getByLabel('WhatsApp number').fill('98765');
  await form.getByLabel('Your channel').fill('my channel');
  await form.getByRole('checkbox').check();
  await button(page).click();
  await expect(form.getByLabel('WhatsApp number')).toBeFocused();
  await expect(form.getByLabel('WhatsApp number')).toHaveAccessibleDescription(
    'Start with + and your country code.',
  );
  await expect(form.getByLabel('Your channel')).toHaveAccessibleDescription(
    'Add a link like instagram.com/yourname, or an @handle.',
  );
  expect(orders).toHaveLength(0);
  await expect(page).toHaveURL(/\/premium\/\?ref=producthunt$/);
});

test('without the agreement nothing is sent', async ({ page }) => {
  await openForm(page);
  const orders = await mockCheckout(page);
  await fillOrder(page);
  await orderForm(page).getByRole('checkbox').uncheck();
  await button(page).click();
  await expect(orderForm(page).getByRole('checkbox')).toBeFocused();
  await expect(orderForm(page).getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
  expect(orders).toHaveLength(0);
});

test('a number the billing service asks for again shows the form’s own words on the field', async ({
  page,
}) => {
  await openForm(page);
  const orders = await mockCheckout(page, {
    status: 400,
    body: { code: 'billing.invalid', problems: [{ path: 'whatsapp', rule: 'required' }] },
  });
  await fillOrder(page);
  await button(page).click();
  const number = orderForm(page).getByLabel('WhatsApp number');
  await expect(number).toBeFocused();
  await expect(number).toHaveAccessibleDescription('Add your number, like +14155550100.');
  expect(orders).toHaveLength(1);
});

test('an address the billing service would refuse is caught beside the field, and nothing is sent', async ({
  page,
}) => {
  await openForm(page);
  const orders = await mockCheckout(page);
  await fillOrder(page);
  const email = orderForm(page).getByLabel('Your email');
  for (const [typed, words] of [
    [
      'asha,rao@example.com',
      'Take out what an address can’t have, like a comma, a quote or an accent after the @.',
    ],
    [
      'asha@exa_mple.com',
      'Take out what an address can’t have, like a comma, a quote or an accent after the @.',
    ],
    ['asha@example', 'Add the part after the @, like example.com.'],
    ['asha rao@example.com', 'Take out the space. Addresses have none.'],
  ] as const) {
    await email.fill(typed);
    await button(page).click();
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAccessibleDescription(words);
  }
  expect(orders).toHaveLength(0);
  // An accented domain is one the service takes once the browser writes it plainly (Chromium's email field does).
  await mockPayPage(page);
  await email.fill('asha@bücher.de');
  await button(page).click();
  await page.waitForURL(PAY_URL);
  expect(sent(orders[0]!)).toMatchObject({ email: 'asha@xn--bcher-kva.de' });
});
