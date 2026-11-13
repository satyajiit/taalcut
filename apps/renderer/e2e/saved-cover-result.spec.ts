// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { axeFor, expectAccessible, settle } from './axe.ts';
import { fakeChat, open, preferences, watchProblems } from './support.ts';

const captures = new URL('../../../.impeccable/review/saved-cover/', import.meta.url).pathname;

for (const theme of ['light', 'dark'] as const) {
  test(`saved JPEG preview and download remain usable in a narrow column (${theme})`, async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await page.setViewportSize({ width: 1100, height: 800 });
    await fakeChat(page, {});
    await preferences(page, { theme, locale: 'en' });
    await open(page, { name: 'dev-kit', path: '/dev/kit' });
    const cover = page.locator('[data-slot=saved-cover-result]');
    await cover.evaluate((element) => {
      element.style.width = '400px';
    });
    const image = cover.getByRole('img', { name: 'Exported cover' });
    await expect(image).toBeVisible();
    await expect(image).toHaveJSProperty('complete', true);
    await expect(cover.getByText('Golden hour cover.jpg')).toBeVisible();
    await expect(cover.getByRole('button', { name: 'Save JPEG' })).toBeVisible();
    await cover.getByRole('button', { name: 'Save JPEG' }).focus();
    await expect(cover.getByRole('button', { name: 'Save JPEG' })).toBeFocused();
    expect(await cover.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expectAccessible(
      page,
      testInfo,
      `Saved cover (${theme})`,
      axeFor(page).include('[data-slot=saved-cover-result]'),
    );
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    mkdirSync(captures, { recursive: true });
    await cover.scrollIntoViewIfNeeded();
    const box = await cover.boundingBox();
    if (!box) throw new Error('Saved cover is not visible');
    await page.screenshot({
      path: `${captures}${theme}.png`,
      clip: { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 },
    });
    expect(problems).toEqual([]);
  });
}
