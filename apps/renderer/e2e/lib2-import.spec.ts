// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { axeFor, settle } from './axe';
import { expect, test } from '@playwright/test';
import { fakeChat, preferences } from './support';

type ImportFakeWindow = {
  taalcutFake?: { dispatched: { name: string }[]; transfer: { state(): { opens: number } } };
};

const variants = [
  { name: 'compact-light', width: 960, height: 600, theme: 'light', locale: 'en' },
  { name: 'standard-dark', width: 1280, height: 800, theme: 'dark', locale: 'en' },
  { name: 'wide-light', width: 1600, height: 900, theme: 'light', locale: 'en' },
  { name: 'compact-hindi', width: 960, height: 600, theme: 'light', locale: 'hi' },
  { name: 'pseudo-dark', width: 1280, height: 800, theme: 'dark', locale: 'en-XA' },
] as const;
for (const variant of variants) {
  test(`LIB2 choose and review: ${variant.name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await preferences(page, { theme: variant.theme, locale: variant.locale });
    await fakeChat(page, { library: 'empty', indexingTickMs: 0 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/library/import/folder');
    await page.locator('[data-action=import-connect]').click();
    const row = page.locator('[data-item-index="0"]');
    await expect(row).toBeVisible();
    await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-action=review-import]')).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.locator('[role=option]').count()).toBeLessThan(20);
    const selection = page.locator('[data-action=review-import]');
    await expect(selection).toBeInViewport();
    expect((await axeFor(page).analyze()).violations).toEqual([]);
    await settle(page);
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`choose-${variant.name}.png`) });
    await selection.click();
    const start = page.locator('[data-action=start-import]');
    await expect(start).toBeEnabled();
    await expect(start).toBeInViewport();
    await settle(page);
    await page.screenshot({ animations: 'disabled', path: info.outputPath(`review-${variant.name}.png`) });
    expect((await axeFor(page).analyze()).violations).toEqual([]);
    const route = page.url();
    await page.reload();
    await expect(start).toBeEnabled();
    expect(page.url()).toBe(route);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as ImportFakeWindow).taalcutFake?.dispatched.filter(
            (item) => item.name === 'imports.start',
          ).length,
      ),
    ).toBe(0);
    await start.click();
    await expect(page).toHaveURL(/\/library\/imports\/[0-9A-Z]{26}$/);
    const receipt = page.url();
    await page.reload();
    await expect(page).toHaveURL(receipt);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as ImportFakeWindow).taalcutFake?.dispatched.filter(
              (item) => item.name === 'imports.start',
            ).length,
        ),
      )
      .toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('LIB2 keyboard selection, forced colours and explicit network start', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await preferences(page, { locale: 'en', theme: 'light' });
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('/library/import/folder');
  await page.locator('[data-action=import-connect]').click();
  const first = page.locator('[data-item-index="0"]');
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-item-index="1"]')).toBeFocused();
  await page.keyboard.press('Shift+Space');
  await expect(page.locator('[data-item-index="1"]')).toHaveAttribute('aria-selected', 'true');
  await page.goto('/library/import/phone-wifi');
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as ImportFakeWindow).taalcutFake?.transfer.state().opens),
  ).toBe(0);
  await expect(page.locator('[data-slot=global-loader]')).toHaveCount(0);
  await settle(page);
  expect((await axeFor(page).analyze()).violations).toEqual([]);
});
