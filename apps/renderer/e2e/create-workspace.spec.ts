// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, test } from '@playwright/test';
import { expectAccessible, settle } from './axe';
import { preferences } from './support';

for (const variant of [
  { name: 'compact-light', width: 960, height: 600, locale: 'en', theme: 'light' },
  { name: 'standard-dark', width: 1280, height: 800, locale: 'en', theme: 'dark' },
  { name: 'compact-hindi', width: 960, height: 600, locale: 'hi', theme: 'light' },
  { name: 'pseudo-dark', width: 1280, height: 800, locale: 'en-XA', theme: 'dark' },
] as const) {
  test(`Create brief and workspace: ${variant.name}`, async ({ page }, info) => {
    await page.setViewportSize(variant);
    await preferences(page, variant);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/create/new?category=product-launch');
    await page.locator('#create-title').fill('OpenAlly launch');
    await page
      .locator('#create-prompt')
      .fill('Show the question becoming an answer in one continuous camera move.');
    await page.locator('#create-audience').fill('Product teams');
    await page.locator('#create-cta').fill('Try OpenAlly');
    await expectAccessible(page, info, 'creation brief');
    await page.locator('form button[type=submit]').click();
    await expect(page).toHaveURL(/\/create\/[0-9A-Z]{26}/);
    await expect(page.locator('#create-url')).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page
      .locator('[data-slot=page]')
      .evaluate((element) => element.scrollTo(0, 0))
      .catch(() => undefined);
    await settle(page);
    await expectAccessible(page, info, 'creation workspace');
    await page.screenshot({ path: info.outputPath(`${variant.name}.png`), animations: 'disabled' });
  });
}

test('Create approves a researched design and edits its retained source in the shared editor', async ({
  page,
}, info) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await page.goto('/create/new');
  await page.getByRole('textbox', { name: 'Video name' }).fill('OpenAlly');
  await page
    .getByRole('textbox', { name: 'What should the video say?' })
    .fill('Answers that keep the team moving.');
  await page.getByRole('button', { name: 'Save brief & add sources' }).click();
  await page.getByRole('textbox', { name: 'Website or document URL' }).fill('https://example.com/product');
  await page.getByRole('button', { name: 'Add URL' }).click();
  await expect(page.getByText('example.com', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Research & draft script' }).click();
  await page
    .getByRole('textbox', { name: 'What is the one benefit viewers should remember?' })
    .fill('Know the next step.');
  await page.getByRole('button', { name: 'Save answers' }).click();
  await expect(page.getByRole('button', { name: 'Review script' })).toBeDisabled();
  await page.getByRole('button', { name: 'Research & draft script' }).click();
  await page.getByRole('button', { name: 'Review script' }).click();
  await page.getByRole('button', { name: 'Review visual direction' }).click();
  await expect(page.getByRole('img', { name: 'Proposed visual direction' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve script & design' }).click();
  await page.getByRole('link', { name: 'Open editor' }).first().click();
  const inspector = page.locator('[data-slot=authored-inspector]');
  await expect(inspector).toBeVisible();
  await inspector.getByRole('textbox', { name: 'Text', exact: true }).fill('OpenAlly, together');
  await inspector.getByRole('button', { name: 'Save layer', exact: true }).click();
  await expect(inspector.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(
    'OpenAlly, together',
  );
  await expectAccessible(page, info, 'authored editor');
  await page.screenshot({ path: info.outputPath('authored-editor.png'), animations: 'disabled' });
});
