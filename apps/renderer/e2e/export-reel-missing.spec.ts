// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// REF1, sound's request: Golden hour market's videos play the reel's music. When the template no longer keeps the
// reel, an export stops at preflight with the fix that gets it again. The export dialog names the cause as the
// reel's music, not a missing clip, and "Get the reel's video and music" gets it, then starts the export over. Axe
// and a screenshot in light and dark.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { TEMPLATE } from './routes.ts';
import { fakeChat, open, preferences, screenshotWhole } from './support.ts';

const EDITOR = {
  name: 'editor',
  path: '/projects/01K7C5M6Q8R9S0T1V2W3X4Y5ZA/timeline?timeline=01K7C5M6Q8R9S0T1V2W3X4Y5ZB',
};

/** In the page's fake: Golden hour market's template forgets its reel. */
async function forgetTheReel(page: Page) {
  await page.evaluate((templateId) => {
    // The page's fake (src/backend/fake/expose.ts); the e2e build declares only part of it.
    const fake = window.taalcutFake as unknown as {
      templates: { keepMedia: (id: string, media: null) => unknown };
    };
    fake.templates.keepMedia(templateId, null);
  }, TEMPLATE);
}

test.describe('an export whose reel is no longer kept (REF1)', () => {
  for (const theme of ['light', 'dark'] as const)
    test(`the export says why and gets the reel, then the form is back (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { latencyMs: 30, renderTickMs: 20 });
      // Golden hour market's first video: its music is the reel's.
      await open(page, EDITOR);
      await page.locator('[data-slot=export]').click();
      const dialog = page.getByRole('dialog', { name: 'Export' });
      await expect(dialog.locator('[data-slot=export-form]')).toBeVisible();
      await forgetTheReel(page);
      await dialog.locator('[data-slot=export-stepper] button[data-step=summary]').click();
      await dialog.getByRole('button', { name: /^Export for/ }).click();

      const get = dialog.locator('[data-slot=export-get-reel]');
      await expect(get).toHaveText('Get the reel’s video and music', { timeout: 15_000 });
      await expect(dialog).toContainText('The reel’s music isn’t kept with its template any more.');
      await expect(dialog).not.toContainText('A clip in this video is missing');
      await expectAccessible(page, testInfo, `export dialog, the reel is gone (${theme})`);
      await screenshotWhole(page, `screenshots/${theme}/ref1-export-reel-missing.png`);
      await get.click();
      // The reel is back, and the dialog starts the export over.
      await expect(dialog.locator('[data-slot=export-form]')).toBeVisible({ timeout: 15_000 });
    });
});
