// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-TPL: the Templates page's search field also searches by meaning and slot intents (templates.search over the
// fake, fake-template-search.ts) and lists what it finds under the field, each with what matched it. Words only
// until the Search model is downloaded, and it says so; then meaning and a slot's intent as the template wrote it.
// What you can search by before you type, no match, a failed search with Try again, the keys (↓ ↑, Return opens,
// Escape closes then clears), in light and dark, axe-clean, and in the pseudo-locale with nothing left in English or
// clipped. Screenshots go to e2e-artifacts/screens/template-search/ (or $TAALCUT_TPL_SCREENS).
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { clippedText, englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { ARTIFACTS, fakeChat, open, preferences } from './support.ts';

const SCREENS = process.env.TAALCUT_TPL_SCREENS ?? new URL('screens/template-search/', ARTIFACTS).pathname;
const shot = (theme: string, name: string, size = '1280x800') =>
  `${SCREENS.replace(/\/?$/, '/')}${theme}/${name}-${size}.png`;
const TEMPLATES = { name: 'templates', path: '/templates' };

const field = (page: Page) => page.getByRole('combobox', { name: 'Search your templates' });
const panel = (page: Page) => page.locator('[data-slot=template-search-panel]');
const results = (page: Page) => page.getByRole('listbox', { name: 'Matching templates' }).getByRole('option');
const matched = (page: Page, name: string) =>
  results(page).filter({ hasText: name }).locator('[data-slot=matched-by]');

for (const theme of ['light', 'dark'] as const) {
  test.describe(`template search, ${theme}`, () => {
    test('words only until the Search model is here, and it says so', async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, {});
      await open(page, TEMPLATES);
      await field(page).click();
      await expect(panel(page)).toHaveText(
        'Search by a template’s name, what it’s about, or a shot it needs.',
      );
      await page.screenshot({ path: shot(theme, 'focus') });
      await expectAccessible(page, testInfo, `template search, before any words (${theme})`);

      await field(page).fill('sea');
      await expect(matched(page, 'Golden hour market')).toHaveText('Matched by words');
      await expect(panel(page).locator('[data-slot=words-only]')).toHaveText(
        'Matching words only. Searching by meaning starts when the Search model is downloaded.',
      );
      await page.screenshot({ path: shot(theme, 'words-only') });
      await expectAccessible(page, testInfo, `template search, words only (${theme})`);

      await field(page).fill('breakfast');
      await expect(panel(page).getByRole('status')).toHaveText(
        'No template has the words “breakfast”. Searching by meaning starts when the Search model is downloaded.',
      );
      await page.screenshot({ path: shot(theme, 'words-only-none') });
      await expectAccessible(page, testInfo, `template search, words only, none (${theme})`);
    });

    test('by meaning and slot intents once the model is here', async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { templateSearch: 'ready' });
      await open(page, TEMPLATES);
      await field(page).fill('breakfast');
      await expect(matched(page, 'Slow morning routine')).toHaveText(
        'Matched by meaning · slot 7’s intent: Café table, first sip',
      );
      await expect(panel(page).locator('[data-slot=words-only]')).toHaveCount(0);
      for (const size of [
        [1280, 800],
        [1024, 720],
      ] as const) {
        await page.setViewportSize({ width: size[0], height: size[1] });
        await page.screenshot({ path: shot(theme, 'meaning', `${size[0]}x${size[1]}`) });
      }
      await expectAccessible(page, testInfo, `template search by meaning (${theme})`);

      await field(page).fill('zebra');
      await expect(panel(page).getByRole('status')).toHaveText(
        'No template matches “zebra” by its words or its meaning.',
      );
      await page.screenshot({ path: shot(theme, 'no-match') });
      await expectAccessible(page, testInfo, `template search, no match (${theme})`);
    });

    test('a search that fails says so with Try again', async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { templateSearch: 'failing' });
      await open(page, TEMPLATES);
      await field(page).fill('sea');
      await expect(panel(page).getByRole('alert')).toBeVisible();
      await expect(panel(page).getByRole('button', { name: 'Try again' })).toBeVisible();
      await page.screenshot({ path: shot(theme, 'failed') });
      await expectAccessible(page, testInfo, `template search failed (${theme})`);
    });
  });
}

test('keys: ↓ and ↑ move through the results, Return opens one, Escape closes then clears', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakeChat(page, { templateSearch: 'ready' });
  await open(page, TEMPLATES);
  await field(page).fill('sea');
  await expect(results(page).first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  const first = results(page).first();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(field(page)).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id')) ?? '');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(field(page)).toHaveValue('sea');
  await page.keyboard.press('ArrowDown');
  await expect(panel(page)).toBeVisible();
  const name = (await first.locator('[data-user-content]').first().textContent()) ?? '';
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/templates\/[0-9A-Z]{26}$/);
  // The bar reads "Templates › <name>".
  await expect(page.locator('h1').first()).toContainText(name);
});

test.describe('template search, pseudo-locale', () => {
  test.use({ viewport: { width: 1024, height: 720 } });
  const phrases = englishPhrases();

  test('nothing in English or clipped in the panel', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await fakeChat(page, { templateSearch: 'ready' });
    await open(page, TEMPLATES);
    // The field's name is in the pseudo-locale too.
    await page.locator('form[role=search] input').fill('breakfast');
    await expect(page.locator('[data-slot=template-search-result]').first()).toBeVisible();
    const found = await userFacingText(page, '[data-slot=template-search-panel]');
    expect(untranslated(found)).toEqual([]);
    expect(englishShowing(found, phrases)).toEqual([]);
    expect(await clippedText(page, '[data-slot=template-search-panel] *')).toEqual([]);
    await page.screenshot({ path: shot('pseudo', 'meaning', '1024x720') });
  });
});
