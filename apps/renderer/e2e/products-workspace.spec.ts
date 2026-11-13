// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, test } from '@playwright/test';
import { expectAccessible, settle } from './axe';
import { PRODUCT } from './routes';
import { preferences } from './support';

test('secondary product views stay reachable and accessible at the minimum window', async ({
  page,
}, info) => {
  test.slow();
  await page.setViewportSize({ width: 960, height: 600 });
  await preferences(page, { locale: 'en', theme: 'dark' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/products/${PRODUCT}?view=knowledge`);
  await expect(page.getByRole('textbox', { name: 'Search product knowledge' })).toBeVisible();
  const views = page.getByRole('radiogroup', { name: 'Product workspace' });
  for (const [label, view, region] of [
    ['Videos', 'videos', 'Product videos'],
    ['Publishing', 'publishing', 'Publishing'],
    ['Schedule', 'schedule', 'Background work'],
    ['Activity', 'activity', 'Activity'],
  ] as const) {
    await views.getByRole('radio', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]view=${view}(?:&|$)`));
    await expect(page.getByRole('region', { name: region, exact: true })).toBeVisible();
    await expect(views.getByRole('radio', { name: label, exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectAccessible(page, info, `compact product ${view}`);
  }
  await views.getByRole('radio', { name: 'Product settings', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=settings(?:&|$)/);
  await expectAccessible(page, info, 'compact product settings');
});

for (const variant of [
  { name: 'compact-light', width: 960, height: 600, locale: 'en', theme: 'light' },
  { name: 'standard-dark', width: 1280, height: 800, locale: 'en', theme: 'dark' },
  { name: 'pseudo-dark', width: 960, height: 600, locale: 'en-XA', theme: 'dark' },
] as const) {
  test(`Product setup and research: ${variant.name}`, async ({ page }, info) => {
    await page.setViewportSize(variant);
    await preferences(page, variant);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/products/new');
    await page.locator('#product-name').fill('OpenAlly');
    await page.locator('#product-description').fill('A workspace for building and sharing useful products.');
    await page.locator('#product-source-url').fill('https://example.com/openally');
    // URL is a local staged attachment; submitting the form persists the entire product once.
    await page
      .locator('section')
      .filter({ has: page.locator('#product-source-url') })
      .locator('button')
      .first()
      .click();
    await expectAccessible(page, info, 'product setup');
    await page.locator('form button[type=submit]').click();
    await expect(page).toHaveURL(/\/products\/[0-9A-Z]{26}/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await settle(page);
    await expectAccessible(page, info, 'product ideas');
    await page.screenshot({ path: info.outputPath(`${variant.name}.png`), animations: 'disabled' });
  });
}
