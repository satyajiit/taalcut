// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-L3 "Done when" (v1.0 gate criterion 5, with the native review, H8): every route in the four app languages
// fits at 1024 × 720 and at the window's minimum size (960 × 600, desktop's window.ts): no box whose content is
// wider than it, none that clips its content's height (Devanagari matras and descenders included), no select value
// or placeholder cut short, no table scrolling sideways, no page wider than the window. No English is left where
// the language has its own words, and Hindi text reaches Noto Sans Devanagari. With TAALCUT_I18N_SCREENS set, every
// route is also saved in light and dark for the native reviewers (<dir>/<locale>/<theme>/<route>.png).
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  clippedFields,
  clippedText,
  englishShowing,
  translatedPhrases,
  userFacingText,
  type Finding,
} from './inspect.ts';
import { ROUTES } from './routes.ts';
import { open, preferences, screenshotWhole } from './support.ts';

const LANGUAGES = ['en', 'hi', 'es', 'pt-BR'] as const;
const DEFAULT = { width: 1024, height: 720 };
const MINIMUM = { width: 960, height: 600 };
const SCREENS = process.env.TAALCUT_I18N_SCREENS;
/**
 * Every box, the shell's included, except a name the person wrote (a project, a template, a folder): it can be any
 * length, the layout truncates it on purpose, and the catalogue doesn't own it. Those are the user content itself
 * and a box holding nothing but it (the window title's project name).
 */
const BOXES =
  'body *:not([data-user-content], [data-user-content] *, :has(> [data-user-content]:only-child))';

const at = (size: { width: number; height: number }, found: Finding[]) =>
  found.map((each) => ({ ...each, where: `${size.width}×${size.height} ${each.where}` }));

/**
 * A table whose scroller scrolls sideways: the scroller is the fallback for a window narrower than any shipped, not
 * room for longer words (no table scrolls in English at these sizes).
 */
async function sidewaysTables(page: Page): Promise<Finding[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-scroll-x]:has(> table)')]
      .filter((box) => box.scrollWidth > box.clientWidth + 1)
      .map((box) => ({
        text: `table scrolls sideways (${box.scrollWidth} > ${box.clientWidth})`,
        where: box.getAttribute('aria-label') ?? 'table',
      })),
  );
}

/** Text that doesn't fit at this size. */
async function overflowAt(page: Page, size: { width: number; height: number }): Promise<Finding[]> {
  await page.setViewportSize(size);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const wider = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  return at(size, [
    ...(wider ? [{ text: 'page is wider than the window', where: 'html' }] : []),
    // A box with no words has nothing to cut: an indeterminate progress stripe is clipped by its track by design.
    ...(await clippedText(page, BOXES)).filter((found) => found.text !== ''),
    ...(await clippedFields(page, BOXES)),
    ...(await sidewaysTables(page)),
  ]);
}

/** Every Devanagari run on the page is drawn with Noto Sans Devanagari (loaded, in its font stack). */
async function devanagariFont(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const problems: string[] = [];
    if (!document.fonts.check('16px "Noto Sans Devanagari Variable"', 'हिन्दी'))
      problems.push('Noto Sans Devanagari is not loaded');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<string>();
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!el || !/[ऀ-ॿ]/.test(walker.currentNode.textContent ?? '')) continue;
      const family = getComputedStyle(el).fontFamily;
      if (!/Noto Sans Devanagari/.test(family) && !seen.has(family)) {
        seen.add(family);
        problems.push(`${el.tagName.toLowerCase()}: ${family}`);
      }
    }
    return problems;
  });
}

for (const locale of LANGUAGES) {
  test.describe(`${locale}`, () => {
    const phrases = locale === 'en' ? [] : translatedPhrases(locale);

    for (const route of ROUTES) {
      test(`${route.name}: fits at 1024×720 and at the minimum window`, async ({ page }) => {
        await page.setViewportSize(DEFAULT);
        await page.emulateMedia({ colorScheme: 'light' });
        await preferences(page, { locale, theme: 'system' });
        await open(page, route);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);

        const overflow = [...(await overflowAt(page, MINIMUM)), ...(await overflowAt(page, DEFAULT))];
        expect(overflow, 'text that does not fit').toEqual([]);

        if (phrases.length > 0) {
          const english = englishShowing(await userFacingText(page), phrases);
          expect(english, `English left on a ${locale} page`).toEqual([]);
        }
        if (locale === 'hi') expect(await devanagariFont(page), 'Hindi text without Noto').toEqual([]);

        if (SCREENS) {
          for (const theme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: theme });
            await screenshotWhole(page, join(SCREENS, locale, theme, `${route.name}.png`));
          }
        }
      });
    }
  });
}
