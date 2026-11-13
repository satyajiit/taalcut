// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// IX-R3, IX-R4: the two finish lines on screen. While the fake phone import runs, the strip says how many clips
// are searchable (and shows it under the bar), a clip search can already find says "Searchable" on its tile, its
// page groups the stages by finish line, and search says how many clips it can't find yet. Each in light and dark,
// axe-clean, and in the pseudo-locale with nothing left in English or clipped. Screenshots go to
// e2e-artifacts/screens/import-milestones/ (or $TAALCUT_IX_SCREENS).
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { clippedText, englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { ARTIFACTS, fakeChat, open, preferences } from './support.ts';

const SCREENS = process.env.TAALCUT_IX_SCREENS ?? new URL('screens/import-milestones/', ARTIFACTS).pathname;
const shot = (theme: string, name: string) => `${SCREENS.replace(/\/?$/, '/')}${theme}/${name}.png`;

const strip = (page: Page) => page.locator('[data-slot=import-strip]');
const searchableTile = (page: Page) =>
  page.locator('[data-slot=clip-tile]', {
    has: page.locator('[data-slot=clip-status]', { hasText: /^Searchable$/ }),
  });

for (const theme of ['light', 'dark'] as const) {
  test.describe(`two finish lines, ${theme}`, () => {
    test('the strip, a searchable tile, its page and search while the import runs', async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { indexingTickMs: 0 });
      await open(page, { name: 'library', path: '/library' });

      await expect(strip(page)).toContainText(/\d+ of 120 searchable/);
      await expect(strip(page)).toContainText(/\d+ fully analysed/);
      await expect(strip(page).locator('[data-slot=import-searchable-bar]')).toBeVisible();
      await strip(page).screenshot({ path: shot(theme, 'library-strip') });

      const tile = searchableTile(page).first();
      await tile.scrollIntoViewIfNeeded();
      await expect(tile).toBeVisible();
      await tile.screenshot({ path: shot(theme, 'tile-searchable') });
      await page.screenshot({ path: shot(theme, 'library') });
      await expectAccessible(page, testInfo, `library while importing (${theme})`);

      const href = await tile.getAttribute('href');
      expect(href).toMatch(/^\/library\/\w+$/);
      await open(page, { name: 'clip', path: href ?? '' });
      const stages = page.locator('section[aria-labelledby=clip-stages]');
      // What the clip is good for already leads (LIB1-PROG), and search's group says it is done.
      await expect(stages.getByRole('heading', { level: 2 })).toHaveText(
        /^You can (play and )?search this clip now$/,
      );
      await expect(stages.locator('[data-slot=clip-groups] [data-group=search]')).toHaveAttribute(
        'data-state',
        'done',
      );
      await stages.screenshot({ path: shot(theme, 'clip-stages-searchable') });
      await expectAccessible(page, testInfo, `a searchable clip (${theme})`);

      await open(page, { name: 'search', path: '/library?q=sunset' });
      const notYet = page.locator('[data-slot=not-searchable]');
      await expect(notYet).toContainText(/clips aren’t searchable yet/);
      await page.screenshot({ path: shot(theme, 'search-while-importing') });
      await expectAccessible(page, testInfo, `search while importing (${theme})`);
    });

    test('the import card in every state', async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { indexingTickMs: 0 });
      await open(page, { name: 'dev-kit', path: '/dev/kit' });
      const expected: Record<string, RegExp> = {
        indexing: /22 of 40 searchable/,
        allSearchable: /You can search every clip from .*Analysing details/,
        paused: /Paused: clips from .*22 of 40 searchable/,
        someFailed:
          /2 files couldn’t be read\. They may be damaged or in a format Taalcut doesn’t read yet\./,
        done: /40 clips ready/,
      };
      for (const [state, text] of Object.entries(expected)) {
        const figure = page.locator(`figure[data-fixture="importProgress · ${state}"]`);
        await figure.scrollIntoViewIfNeeded();
        await expect(figure).toContainText(text);
        await figure.screenshot({ path: shot(theme, `card-${state}`) });
      }
      await expectAccessible(page, testInfo, `import cards (${theme})`);
    });
  });
}

test.describe('two finish lines, pseudo-locale', () => {
  test.use({ viewport: { width: 1024, height: 720 } });
  const phrases = englishPhrases();

  test('nothing in English or clipped on the strip, a searchable clip or search', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await fakeChat(page, { indexingTickMs: 0 });
    const checkPage = async (name: string) => {
      const text = await userFacingText(page);
      expect(englishShowing(text, phrases), `${name}: English source strings on screen`).toEqual([]);
      expect(untranslated(text), `${name}: strings that skipped the catalogue`).toEqual([]);
      expect(await clippedText(page), `${name}: text that does not fit`).toEqual([]);
      await page.screenshot({ path: shot('pseudo', name) });
    };

    await open(page, { name: 'library', path: '/library' });
    await expect(strip(page).locator('[data-slot=import-milestone]')).toBeVisible();
    await checkPage('library');
    const tile = page
      .locator('[data-slot=clip-tile]', { has: page.locator('[data-slot=clip-status] svg.lucide-search') })
      .first();
    await tile.scrollIntoViewIfNeeded();
    const href = await tile.getAttribute('href');
    await open(page, { name: 'clip', path: href ?? '' });
    await expect(page.locator('[data-slot=clip-groups] [data-group=search][data-state=done]')).toBeVisible();
    await checkPage('clip-searchable');
    await open(page, { name: 'search', path: '/library?q=sunset' });
    await expect(page.locator('[data-slot=not-searchable]')).toBeVisible();
    await checkPage('search');
  });
});
