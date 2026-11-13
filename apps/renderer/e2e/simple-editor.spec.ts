// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, test } from '@playwright/test';
import { PROJECT } from './routes.ts';
import { fakeChat, open, preferences, watchProblems } from './support.ts';
import { expectAccessible, expectPseudoClean } from './ui2b-support.ts';

const editor = { name: 'simple-editor', path: `/projects/${PROJECT}/timeline` };
const sizes = [
  { width: 960, height: 600, chat: 320 },
  { width: 1280, height: 800, chat: 360 },
  { width: 1440, height: 900, chat: 400 },
];

test('changing timeline detail keeps the same narration controls mounted', async ({ page }) => {
  await fakeChat(page, { speed: 0, latencyMs: 0 });
  await open(page, editor);
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  const narration = page.getByRole('region', { name: 'Record voice', exact: true });
  const original = await narration.elementHandle();
  await expect(narration).toBeVisible();
  await page.locator('[data-slot=timeline-detail-toggle]').click();
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  await expect(narration).toBeVisible();
  expect(await narration.evaluate((current, previous) => current === previous, original)).toBe(true);
  await page.locator('[data-slot=timeline-detail-toggle]').click();
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  expect(await narration.evaluate((current, previous) => current === previous, original)).toBe(true);
});

for (const theme of ['light', 'dark'] as const) {
  for (const size of sizes) {
    test(`${theme} ${size.width}: persistent chat, scenes and lower controls`, async ({ page }, info) => {
      const problems = await watchProblems(page);
      await page.setViewportSize(size);
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { speed: 0, latencyMs: 0 });
      await open(page, editor);
      const scenes = page.locator('[data-slot=scene-strip]');
      const chat = page.locator('[data-slot=editor-dock]');
      await expect(scenes).toBeVisible();
      await expect(chat).toBeVisible();
      await expect(page.getByRole('button', { name: 'Detailed timeline', exact: true })).toBeInViewport();
      const bounds = await chat.boundingBox();
      expect(bounds?.width).toBe(size.chat);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('scenes.png'), animations: 'disabled' });
      await expectAccessible(page, info, `simple scenes ${theme} ${size.width}`);
      await scenes.getByRole('button').nth(1).click();
      await scenes
        .getByRole('button')
        .nth(3)
        .click({ modifiers: ['Shift'] });
      await expect(page.getByRole('button', { name: 'Adjust selected (3)' })).toBeVisible();
      await page.getByRole('button', { name: 'Trim', exact: true }).click();
      const inspector = page.getByRole('complementary', { name: 'Inspector' });
      await expect(inspector).toBeVisible();
      if (size.width === 1440) {
        await expect(inspector.getByText('Beginning', { exact: true })).toBeInViewport({ ratio: 1 });
        await expect(inspector.getByText('End', { exact: true })).toBeInViewport({ ratio: 1 });
        await expect(inspector.getByRole('button', { name: /^Restore / }).last()).toBeInViewport({
          ratio: 1,
        });
      }
      await expect(chat).toBeInViewport();
      await page.screenshot({ path: info.outputPath('trim.png'), animations: 'disabled' });
      await page.getByRole('button', { name: 'Sound', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Record voice', exact: true })).toBeVisible();
      await expect(chat).toBeInViewport();
      await page.screenshot({ path: info.outputPath('sound.png'), animations: 'disabled' });
      expect(problems).toEqual([]);
    });
  }
}

for (const locale of ['hi', 'en-XA'] as const) {
  test(`${locale}: keyboard and reduced motion at the smallest window`, async ({ page }, info) => {
    const problems = await watchProblems(page);
    await page.setViewportSize({ width: 960, height: 600 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await preferences(page, { locale, theme: 'light' });
    await fakeChat(page, { speed: 0, latencyMs: 0 });
    await open(page, editor);
    const scenes = page.locator('[data-slot=scene-strip]');
    await scenes.getByRole('button').first().focus();
    await page.keyboard.press('Space');
    await expect(scenes.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Tab');
    await expect(scenes.getByRole('checkbox').first()).toBeFocused();
    await expect(page.locator('[data-slot=editor-dock]')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${locale}.png`), animations: 'disabled' });
    if (locale === 'en-XA') await expectPseudoClean(page, 'simple scenes en-XA');
    expect(problems).toEqual([]);
  });
}
