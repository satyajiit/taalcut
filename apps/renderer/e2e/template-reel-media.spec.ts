// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// REF1 (the owner's decision of 2026-10-29): a template's overview says its reel's video and music are kept on this
// Mac, with the size; a template read before REF1 offers "Get the reel's video and music" (templates.fetchMedia),
// shows the download on a neutral bar, then the kept line; a failure names its cause with Try again; a waveform
// flattened before keep's 04e87739 draws as none. Axe and whole-page screenshots in light and dark for each state,
// and the pseudo-locale on each.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { TEMPLATE } from './routes.ts';
import { FAKE_OPTIONS_KEY, open, preferences, screenshotWhole, watchProblems } from './support.ts';
import { expectPseudoCleanWithin } from './templates-support.ts';

/** Golden hour market: read since REF1, so its reel is kept. */
const GOLDEN = { name: 'templates-template', path: `/templates/${TEMPLATE}` };
/** Slow morning routine: read from a reel before REF1, so nothing of the reel is kept yet. */
const MORNING = { name: 'templates-template', path: '/templates/01K7C5M6Q85000000000000002' };

async function fakeTemplates(page: Page, options: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: FAKE_OPTIONS_KEY,
    value: JSON.stringify({ indexingTickMs: 0, ...options }),
  });
}

test.describe('a template’s kept reel (REF1)', () => {
  for (const theme of ['light', 'dark'] as const)
    test(`a template keeps its reel on this Mac; an older one gets its video and music (${theme})`, async ({
      page,
    }, testInfo) => {
      const problems = await watchProblems(page);
      await preferences(page, { theme, locale: 'en' });
      // Slow enough ticks that axe runs while the download shows.
      await fakeTemplates(page, { templateMediaTickMs: 2500 });
      await open(page, GOLDEN);
      const reel = page.locator('[data-slot=reel-media]');
      await expect(reel).toHaveAttribute('data-state', 'kept');
      await expect(reel).toContainText('The reel’s video and music are kept on this Mac');
      await screenshotWhole(page, `screenshots/${theme}/ref1-template-reel-kept.png`);

      // Slow morning routine was read before REF1: its reel isn't kept, and the button gets it.
      await open(page, MORNING);
      await expect(reel).toHaveAttribute('data-state', 'idle');
      await expectAccessible(page, testInfo, `template, reel not kept (${theme})`);
      await screenshotWhole(page, `screenshots/${theme}/ref1-template-reel-missing.png`);
      await page.getByRole('button', { name: 'Get the reel’s video and music' }).click();
      await expect(page.getByRole('button', { name: 'Getting the reel’s video and music' })).toBeVisible();
      await expect(page.locator('[data-slot=reel-media-progress]')).toContainText(
        'Downloading the reference',
      );
      await screenshotWhole(page, `screenshots/${theme}/ref1-template-reel-getting.png`);
      await expectAccessible(page, testInfo, `template, getting the reel (${theme})`);
      await expect(reel).toHaveAttribute('data-state', 'kept', { timeout: 15_000 });
      await expect(reel).toContainText('The reel’s video and music are kept on this Mac');
      expect(problems).toEqual([]);
    });

  for (const theme of ['light', 'dark'] as const)
    test(`a failed fetch names its cause, and Try again gets the reel (${theme})`, async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeTemplates(page, { templateMedia: 'failsOnce', templateMediaTickMs: 0 });
      await open(page, MORNING);
      await page.getByRole('button', { name: 'Get the reel’s video and music' }).click();
      const failed = page.locator('[data-slot=reel-media] [data-slot=error-line]');
      await expect(failed).toContainText('Couldn’t download that reference video.');
      await expectAccessible(page, testInfo, `template, the reel failed (${theme})`);
      await screenshotWhole(page, `screenshots/${theme}/ref1-template-reel-failed.png`);
      await failed.getByRole('button', { name: 'Try again' }).click();
      await expect(page.locator('[data-slot=reel-media]')).toHaveAttribute('data-state', 'kept');
    });

  // Keep's request 41: a template read before keep's 04e87739 has a flat waveform (nearly every peak 1). The strip
  // draws it as none: the slots with their cuts and beats, and no flat band.
  for (const theme of ['light', 'dark'] as const)
    test(`a flat waveform from before the fix draws as none (${theme})`, async ({ page }, testInfo) => {
      const problems = await watchProblems(page);
      await preferences(page, { theme, locale: 'en' });
      await fakeTemplates(page, { templateWaveform: 'flat' });
      await open(page, MORNING);
      const waveform = page.locator('[data-slot=rhythm-bed] [data-slot=beat-waveform]');
      await expect(waveform).toHaveAttribute('data-waveform', 'none');
      await expect(page.locator('[data-slot=rhythm-bed] [data-slot=slot-strip]')).toBeVisible();
      await expectAccessible(page, testInfo, `template, flat waveform (${theme})`);
      await screenshotWhole(page, `screenshots/${theme}/ref1-template-flat-waveform.png`);
      // Golden hour's waveform has its shape, in the same fake.
      await open(page, GOLDEN);
      await expect(waveform).toHaveAttribute('data-waveform', 'shaped');
      expect(problems).toEqual([]);
    });

  test('en-XA: kept, not kept, getting and failed have nothing English and nothing clipped', async ({
    page,
  }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await fakeTemplates(page, { templateMedia: 'failsOnce', templateMediaTickMs: 2500 });
    const reel = page.locator('[data-slot=reel-media]');
    await open(page, GOLDEN);
    await expect(reel).toHaveAttribute('data-state', 'kept');
    await expectPseudoCleanWithin(page, '[data-slot=reel-media]', 'kept');
    await open(page, MORNING);
    await expectPseudoCleanWithin(page, '[data-slot=reel-media]', 'not kept');
    await page.locator('[data-slot=get-reel-media]').click();
    await expect(reel.locator('[data-slot=error-line]')).toBeVisible({ timeout: 15_000 });
    await expectPseudoCleanWithin(page, '[data-slot=reel-media]', 'failed');
    await reel.locator('[data-slot=error-line] button').click();
    await expect(page.locator('[data-slot=reel-media-progress]')).toBeVisible();
    await expectPseudoCleanWithin(page, '[data-slot=reel-media]', 'getting');
    await screenshotWhole(page, 'screenshots/en-XA/ref1-template-reel-getting.png');
  });
});
