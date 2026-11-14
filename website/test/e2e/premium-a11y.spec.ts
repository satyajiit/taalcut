// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openInTheme } from './helpers';
import {
  LAUNCH,
  RETURN_QUERY,
  mockCheckout,
  mockConfirm,
  mockQuote,
  orderForm,
  thanks,
  unpaid,
} from './premium-helpers';

/**
 * The Premium pages in the states the all-pages specs can't reach (those open a page with no billing service behind
 * it, so they see the closed form and the empty thanks page): the open form with a launch price, the form with its
 * problems and a refusal shown, and a returning payment's states. WCAG 2.2 AA in both themes, and no sideways scroll
 * at phone widths with the longest price line and every message on the page.
 */

test.use({ timezoneId: 'Asia/Kolkata', locale: 'en-GB', reducedMotion: 'reduce' });

async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Every field wrong and a refusal under the button: the fullest the form gets. */
async function showProblems(page: Page) {
  const form = orderForm(page);
  await form.getByLabel('Your name').fill('A');
  await form.getByLabel('Your email').fill('asha@');
  await form.getByLabel('WhatsApp number').fill('98765');
  await form.getByLabel('Your channel').fill('my channel');
  await form.locator('button[type="submit"]').click();
  await expect(form.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
}

for (const theme of ['light', 'dark'] as const) {
  test(`/premium/ with a launch price and the form open passes axe in ${theme}`, async ({ page }) => {
    await mockQuote(page, { body: LAUNCH });
    await openInTheme(page, '/premium/?ref=producthunt', theme);
    await expect(page.locator('[data-slot="premium-card"] [data-slot="price-amount"]')).toHaveText('$339');
    expect(await violations(page)).toEqual([]);
  });

  test(`/premium/ with every problem and a refusal shown passes axe in ${theme}`, async ({ page }) => {
    await mockQuote(page, { body: LAUNCH });
    await mockCheckout(page, { status: 500, body: { code: 'billing.busy' } });
    await openInTheme(page, '/premium/?ref=producthunt', theme);
    await showProblems(page);
    expect(await violations(page)).toEqual([]);
    const form = orderForm(page);
    await form.getByLabel('Your name').fill('Asha Rao');
    await form.getByLabel('Your email').fill('asha@example.com');
    await form.getByLabel('WhatsApp number').fill('+14155550100');
    await form.getByLabel('Your channel').fill('');
    await form.getByRole('checkbox').check();
    await form.locator('button[type="submit"]').click();
    await expect(form.getByRole('alert')).toContainText('Our side had a problem. Nothing was charged.');
    expect(await violations(page)).toEqual([]);
  });

  for (const [kind, reply] of [
    ['paid', undefined],
    ['expired', { body: unpaid('expired') }],
    ['refused', { status: 404, body: { code: 'billing.not_found' } }],
    ['unreachable', null],
  ] as const) {
    test(`/premium/thanks/ ${kind} passes axe in ${theme}`, async ({ page }) => {
      await mockConfirm(page, reply);
      await openInTheme(page, `/premium/thanks/${RETURN_QUERY}`, theme);
      await expect(thanks(page)).toHaveAttribute('data-state', kind);
      expect(await violations(page)).toEqual([]);
    });
  }
}

for (const width of [320, 375, 414, 768]) {
  test(`the Premium pages fit ${width} px with a launch price, every problem shown and a paid order`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockQuote(page, { body: LAUNCH });
    await mockConfirm(page);
    await page.goto('/premium/?ref=producthunt');
    await expect(page.locator('[data-slot="premium-card"] [data-slot="price-offer"]')).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await showProblems(page);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await page.goto(`/premium/thanks/${RETURN_QUERY}`);
    await expect(thanks(page)).toHaveAttribute('data-state', 'paid');
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
}

test('the form’s targets are at least 24 px, and the page holds one marigold fill: the form’s button', async ({
  page,
}) => {
  await mockQuote(page, { body: LAUNCH });
  await page.goto('/premium/?ref=producthunt');
  const form = orderForm(page);
  for (const target of [
    form.getByRole('checkbox'),
    form.locator('button[type="submit"]'),
    page.getByRole('link', { name: 'Order Premium' }),
  ]) {
    const box = await target.boundingBox();
    expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(24);
  }
  // The same fill as the form's button, anywhere else in the page's main region, would be a second one.
  const fill = await form
    .locator('button[type="submit"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const filled = await page
    .locator('main a, main button')
    .evaluateAll(
      (els, colour) => els.filter((el) => getComputedStyle(el).backgroundColor === colour).length,
      fill,
    );
  expect(filled).toBe(1);
});
