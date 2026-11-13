// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2-DOWNLOADER round 3 (the window's part, on the fake): every part on this Mac keeps its verified licence notice
// in its folder, and Settings links it. On Settings › Models › Downloads a job's row says "Licence" for one part
// here and "Licences" for several, a menu of them with each one's SPDX id; Settings › General › About's Licences
// list links each part's (UX4: one licences list, on About); a part not here has none. What opened is the part main was asked for (files.openNotice names the part,
// never a path). axe-clean in light and dark. The fake backend lives in the page, so the run moves between the two
// pages with the app's own links, never a reload.
import { expect, test, type Page } from '@playwright/test';
import { preferences } from './support.ts';
import { expectAccessible, fakeState, fakes, shoot } from './ui2b-support.ts';

const job = (page: Page, key: string) =>
  page.getByRole('region', { name: 'Models for this Mac' }).locator(`li[data-job="${key}"]`);
const part = (page: Page, id: string) => page.locator(`li[data-component="${id}"]`);
const opened = (page: Page) => fakeState<string[]>(page, 'onboarding.noticesOpened');
const DOWNLOADS = '/settings/models/downloads';

for (const theme of ['light', 'dark'] as const) {
  test(`a part that is here links its licence on Settings › Models › Downloads and About (${theme})`, async ({
    page,
  }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    // Speech's Whisper tiny and Search's EmbeddingGemma aren't here; everything else is.
    await fakes(page, { models: 'missing', downloadTickMs: 120 });
    await page.goto(DOWNLOADS);
    await expect(job(page, 'search')).toHaveAttribute('data-state', 'missing');

    // One part here (ONNX Runtime): its licence opens at once.
    const one = job(page, 'search').getByRole('button', { name: 'Licence for ONNX Runtime' });
    // The word shows; the whole phrase, the part's name kept out of translation, is what screen readers read.
    await expect(one.locator('[aria-hidden="true"]')).toHaveText('Licence');
    await expect(one.locator('[translate="no"]')).toHaveText('ONNX Runtime');
    await expect(one).not.toHaveAttribute('aria-label');
    await one.click();
    await expect.poll(() => opened(page)).toEqual(['onnxruntime']);

    // Several (Speech's four): a menu of them, each with its SPDX id; Whisper tiny isn't here, so it isn't listed.
    await job(page, 'speech').getByRole('button', { name: 'Licences for Speech' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveCount(4);
    await expect(menu).not.toContainText('Whisper tiny');
    await expect(menu.getByRole('menuitem', { name: /^whisper\.cpp server/ })).toContainText('MIT');
    await shoot(page, `licences-models-menu-${theme}`);
    await expectAccessible(page, testInfo, `settings models, a job's licences (${theme})`);
    await menu.getByRole('menuitem', { name: /^whisper\.cpp server/ }).click();
    await expect.poll(() => opened(page)).toEqual(['onnxruntime', 'whisper-server']);
    await expect(menu).toBeHidden();
    await shoot(page, `licences-models-${theme}`);

    // Settings › General › About: the Licences list has each part's SPDX id and its licence; the part not here
    // has none. General's row, then its About view: the app's own links, never a reload.
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'General' }).click();
    await page
      .locator('[data-slot=settings-views]')
      .getByRole('link', { name: 'About', exact: true })
      .click();
    await expect(page).toHaveURL(/\/settings\/about$/);
    const row = page.getByRole('list', { name: 'Licences' }).locator('li[data-component="whisper-cpp"]');
    await expect(row).toContainText('MIT');
    await expect(part(page, 'whisper-tiny').locator('[data-slot=licence-link]')).toHaveCount(0);
    await row.getByRole('button', { name: 'Licence for whisper.cpp' }).click();
    await expect.poll(() => opened(page)).toEqual(['onnxruntime', 'whisper-server', 'whisper-cpp']);
    await row.scrollIntoViewIfNeeded();
    await shoot(page, `licences-about-${theme}`);
    await expectAccessible(page, testInfo, `settings about, the parts' licences (${theme})`);
  });
}

test('the licence links take focus from the keyboard and open with Return', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { models: 'missing', downloadTickMs: 120 });
  await page.goto(DOWNLOADS);
  const one = job(page, 'search').getByRole('button', { name: 'Licence for ONNX Runtime' });
  await expect(one).toBeVisible();
  // Tab lands on it from the control before it in the page (the row's own name isn't a stop).
  await one.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(one).toBeFocused();
  await expect(one).toHaveCSS('outline-style', 'solid');
  await shoot(page, 'licences-models-focus-light');
  await page.keyboard.press('Enter');
  await expect.poll(() => opened(page)).toEqual(['onnxruntime']);
});
