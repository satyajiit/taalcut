// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P1-H1 "Done when": the pseudo-locale renders every route with no
// untranslated string and no clipped text.
import { expect, test } from '@playwright/test';
import { clippedText, englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { ROUTES } from './routes.ts';
import { open, preferences, screenshotWhole } from './support.ts';

// Narrower than the default window, so long translations have less room.
test.use({ viewport: { width: 1024, height: 720 } });

const phrases = englishPhrases();

test.describe('pseudo-locale (en-XA)', () => {
  for (const route of ROUTES) {
    test(`${route.name}: everything translated, nothing clipped`, async ({ page }) => {
      await preferences(page, { locale: 'en-XA', theme: 'light' });
      await open(page, route);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');

      const text = await userFacingText(page);
      expect(text.length, 'the page shows some text').toBeGreaterThan(1);
      expect(englishShowing(text, phrases), 'English source strings on screen').toEqual([]);
      expect(untranslated(text), 'strings that skipped the catalogue').toEqual([]);
      expect(await clippedText(page), 'text that does not fit').toEqual([]);

      await screenshotWhole(page, `screenshots/pseudo/${route.name}.png`);
    });
  }
});

// The checks above pass only if they can fail: plant the two kinds of mistake.
test('the checks catch English and clipped text', async ({ page }) => {
  await preferences(page, { locale: 'en-XA' });
  await open(page, { name: 'library', path: '/library' });
  await page.evaluate(() => {
    const planted = document.createElement('p');
    planted.textContent = 'Add a folder of videos';
    planted.style.cssText = 'width: 60px; overflow: hidden; white-space: nowrap';
    document.querySelector('main')?.append(planted);
  });
  const text = await userFacingText(page);
  expect(untranslated(text).map((f) => f.text)).toContain('Add a folder of videos');
  expect(englishShowing(text, phrases).map((f) => f.text)).toContain('Add a folder of videos');
  expect((await clippedText(page)).map((f) => f.text)).toContain('Add a folder of videos');
});
