// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-FIX: the Templates page runs one search. The app run typed "a close-up hook with text on screen": the panel
// under the field found a template by its words while the list under it said "No templates match." and counted 0.
// Now, with words, the list is templates.search's answer (the fake's, fake-template-search.ts, as the library's):
// the same templates, in the same order, each row saying what matched, the page's filters applied, and the panel
// lists its first results. A query the every-word filter misses is listed; the count, the panel and the list agree,
// with filters, with no Search model (words only, and it says so over the list too) and with the model; a query
// nothing matches says so in both. Axe-clean in light and dark. Screenshots go to $TAALCUT_FIX_SEARCH_SCREENS.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { fakeChat, open, preferences } from './support.ts';

const SCREENS = process.env.TAALCUT_FIX_SEARCH_SCREENS;
const STRICT = 'a close-up hook with text on screen';
const TEMPLATES = { name: 'templates', path: '/templates' };

const field = (page: Page) => page.getByRole('combobox', { name: 'Search your templates' });
const panel = (page: Page) => page.locator('[data-slot=template-search-panel]');
/** Each result's template name, in order (the first user text of each option; its slot's intent comes after). */
async function panelNames(page: Page): Promise<string[]> {
  const options = page.getByRole('listbox', { name: 'Matching templates' }).getByRole('option');
  const names: string[] = [];
  for (const option of await options.all())
    names.push(await option.locator('[data-user-content]').first().innerText());
  return names;
}
const list = (page: Page) => page.locator('[data-slot=template-list]');
const rows = (page: Page) => list(page).getByRole('option');
// The count is read out, not shown (UX4 tpl: the filter row keeps one line); its words are the same.
const count = (page: Page) => page.locator('[data-slot=templates-count]');
const wordsOnly = (page: Page) => page.locator('[data-slot=words-only]');

/** Each row's name, in order (one name per row, as the windowed list draws them). */
async function listedNames(page: Page): Promise<string[]> {
  const names: string[] = [];
  for (const row of await rows(page).all())
    names.push(await row.locator('[data-user-content]').first().innerText());
  return names;
}

/** Types the words and waits for the list to answer them (the panel reads the same answer). */
async function search(page: Page, words: string) {
  await field(page).fill(words);
  await expect(list(page)).toHaveAttribute('data-answers', words);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
}

async function shots(page: Page, theme: string, name: string) {
  if (!SCREENS) return;
  for (const [width, height] of [
    [1280, 800],
    [1024, 720],
  ] as const) {
    await page.setViewportSize({ width, height });
    // The sidebar folds at the narrower width: let it settle before the picture.
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SCREENS}/${theme}-${name}-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

for (const theme of ['light', 'dark'] as const)
  test.describe(`one template search, ${theme}`, () => {
    test('words the every-word filter misses: the list, its count and the panel agree, words only', async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, {});
      await open(page, TEMPLATES);
      await expect(count(page)).toHaveText('3 templates');
      await search(page, STRICT);
      const listed = await listedNames(page);
      expect([...listed].sort()).toEqual(['Golden hour market', 'Three-hook vlog opener']);
      expect(await panelNames(page)).toEqual(listed);
      await expect(count(page)).toHaveText('2 templates');
      for (const row of await rows(page).all())
        await expect(row.locator('[data-slot=matched-by]')).toHaveText('Matched by words');
      // No Search model yet: the honest line is in the panel and over the list.
      await expect(wordsOnly(page)).toHaveCount(2);
      // The list is best match first: the sort steps aside while there are words.
      await expect(page.locator('[data-slot=sort-pill]')).toHaveCount(0);
      await expect(page).toHaveURL(/q=a\+close-up\+hook/);
      await shots(page, theme, 'words-only-panel');
      await expectAccessible(page, testInfo, `one template search, words only (${theme})`);
      await page.keyboard.press('Escape');
      await expect(panel(page)).toHaveCount(0);
      await expect(wordsOnly(page)).toHaveCount(1);
      await shots(page, theme, 'words-only-list');
    });

    test('by meaning and slot intents, with filters: still one answer; none matches in both', async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { templateSearch: 'ready' });
      await open(page, TEMPLATES);
      await search(page, STRICT);
      const listed = await listedNames(page);
      expect(listed).toHaveLength(3);
      expect(await panelNames(page)).toEqual(listed);
      await expect(count(page)).toHaveText('3 templates');
      const opener = rows(page)
        .filter({ hasText: 'Three-hook vlog opener' })
        .locator('[data-slot=matched-by]');
      await expect(opener).toContainText(
        'slot 1’s intent: Talking to camera: the question the video answers',
      );
      await expect(wordsOnly(page)).toHaveCount(0);
      await shots(page, theme, 'meaning-panel');
      await expectAccessible(page, testInfo, `one template search, by meaning (${theme})`);

      // A filter narrows the answer: the list, the count and the panel narrow together.
      await page.keyboard.press('Escape');
      const rail = page.getByRole('navigation', { name: 'Template folders' });
      await rail.getByRole('link', { name: /^Favourites/ }).click();
      await expect(page).toHaveURL(/\/templates\/folders\/favourites/);
      await field(page).click();
      await expect(panel(page)).toHaveAttribute('data-state', 'ready');
      await expect.poll(() => listedNames(page)).toEqual(['Golden hour market']);
      expect(await panelNames(page)).toEqual(['Golden hour market']);
      await expect(count(page)).toHaveText('1 template');

      // Nothing matches: both say so, and the count is 0.
      await field(page).fill('zebra');
      await expect(panel(page).getByRole('status')).toHaveText(
        'No template matches “zebra” by its words or its meaning.',
      );
      await expect(page.getByText('No templates match.')).toBeVisible();
      await expect(count(page)).toHaveText('0 templates');
      await expect(rows(page)).toHaveCount(0);
      await shots(page, theme, 'no-match');
      await expectAccessible(page, testInfo, `one template search, no match (${theme})`);
    });
  });

test('the words are the URL: a link opens the search’s answer, ⌘F focuses the field, Clear lists every template', async ({
  page,
}) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakeChat(page, { templateSearch: 'ready' });
  await open(page, { name: 'templates-search', path: `/templates?q=${encodeURIComponent(STRICT)}` });
  await expect(field(page)).toHaveValue(STRICT);
  await expect(list(page)).toHaveAttribute('data-answers', STRICT);
  await expect(count(page)).toHaveText('3 templates');
  await page.keyboard.press('ControlOrMeta+f');
  await expect(field(page)).toBeFocused();
  await expect.poll(() => panelNames(page)).toEqual(await listedNames(page));
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(list(page)).toHaveAttribute('data-answers', '');
  await expect(count(page)).toHaveText('3 templates');
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.locator('[data-slot=sort-pill]')).toBeVisible();
});
