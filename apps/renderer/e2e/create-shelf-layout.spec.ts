// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, test, type Page } from '@playwright/test';
import { settle } from './axe';
import { preferences } from './support';

test.use({ viewport: { width: 960, height: 600 } });

async function startVideo(page: Page) {
  await page.goto('/create');
  const idea = page.locator('#create-idea');
  await idea.fill('OpenAlly launch\nShow a question becoming a clear next step.');
  await page.locator('form').filter({ has: idea }).locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/create\/[0-9A-Z]{26}(?:\?|$)/);
  await expect(page.locator('#create-title')).toHaveValue('OpenAlly launch');
  return new URL(page.url()).pathname;
}

async function expectFirstViewport(page: Page) {
  await settle(page);
  const featured = page.locator('[data-slot=creation-shelf-item][data-featured=true]');
  await expect(featured).toHaveCount(1);
  await expect(page.locator('#create-idea')).toBeInViewport({ ratio: 1 });
  await expect(featured.locator('[data-slot=creation-shelf-title]')).toHaveText('OpenAlly launch');
  for (const slot of ['creation-shelf-preview', 'creation-shelf-title', 'creation-shelf-action']) {
    await expect(featured.locator(`[data-slot=${slot}]`)).toBeInViewport({ ratio: 1 });
  }
  return featured;
}

for (const variant of [
  { name: 'light', theme: 'light', locale: 'en' },
  { name: 'dark', theme: 'dark', locale: 'en' },
  { name: 'pseudo-dark', theme: 'dark', locale: 'en-XA' },
] as const) {
  test(`saved video and quick start share the first compact viewport (${variant.name})`, async ({
    page,
  }, info) => {
    await preferences(page, variant);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const projectPath = await startVideo(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/create$/);
    const featured = await expectFirstViewport(page);
    await expect(featured).toHaveAttribute('href', `${projectPath}?step=brief`);
    await page.screenshot({ path: info.outputPath('saved-video-shelf.png'), animations: 'disabled' });
    await featured.click();
    await expect(page.locator('#create-prompt')).toHaveValue(
      'OpenAlly launch\nShow a question becoming a clear next step.',
    );
  });
}

test('a researched visual fills its featured preview in the compact shelf', async ({ page }) => {
  await preferences(page, { locale: 'en', theme: 'light' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const projectPath = await startVideo(page);
  await page.getByRole('button', { name: 'Research & draft script' }).click();
  await expect(page.locator('#answer-promise')).toBeVisible();
  await page.locator('a[href="/create"]').first().click();
  const featured = await expectFirstViewport(page);
  await expect(featured).toHaveAttribute('href', `${projectPath}?step=script`);
  const image = featured.getByRole('img', { name: 'Proposed visual direction' });
  await expect(image).toBeInViewport({ ratio: 1 });
  const frame = featured.locator('[data-slot=creation-shelf-preview]');
  await expect
    .poll(async () => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
  const [mediaBox, frameBox] = await Promise.all([image.boundingBox(), frame.boundingBox()]);
  expect(mediaBox!.width / frameBox!.width, 'the preview uses the available frame width').toBeGreaterThan(
    0.9,
  );
});
