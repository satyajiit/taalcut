// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-OEM: what phones write, on the clip page's facts. The fake's sample clips 20260314_113000.mp4 and VID_0001.mp4
// are two phone clips as the library reads them (synthetic values): a Galaxy with offset +0200 in its file, and a
// file a camera app wrote whose zone is borrowed from it. Set TAALCUT_OEM_SHOTS to a folder to keep screenshots of the facts card
// in light and dark.
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { clippedText, englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { fakeChat, open, preferences, watchProblems } from './support.ts';

/** fakeUlid(KIND.asset, 90_110 and 90_111): backend/fake/library/sample-words.ts, PHONE_CLIPS. */
const CLIPS = {
  samsung: '01K7C5M6Q81000000000002QZY',
  appOnly: '01K7C5M6Q81000000000002QZZ',
  /** IMG_4471.MOV: an iPhone in Goa, offset +05:30, its lens named. */
  iphone: '01K7C5M6Q81000000000002QZN',
  /** IMG_4502.MOV: an iPhone time-lapse, named so by the phone. */
  timeLapse: '01K7C5M6Q81000000000002QZR',
} as const;
const SHOTS = process.env.TAALCUT_OEM_SHOTS;

const capture = (page: Page) =>
  page.locator('[data-slot=clip-facts-group]').filter({ hasText: 'When and where' });

async function clip(page: Page, id: string): Promise<void> {
  await fakeChat(page, { indexingTickMs: 0 });
  await open(page, { name: 'library-asset', path: `/library/${id}` });
}

async function keep(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.locator('[data-slot=clip-facts]').screenshot({ path: join(SHOTS, `${name}-${theme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test.describe('what phones write', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await preferences(page, { locale: 'en', theme: 'system' });
  });

  test('20260314_113000.mp4: Samsung Galaxy Example, filmed at 11:30 in its own zone', async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await clip(page, CLIPS.samsung);
    await expect(capture(page)).toContainText('Samsung Galaxy Example');
    await expect(capture(page)).toContainText('SM-X000Z');
    await expect(capture(page)).toContainText('Mar 14, 2026, 11:30');
    await expect(capture(page)).toContainText('Filmed at GMT+2');
    await expect(capture(page)).not.toContainText('probably');
    await expect(capture(page).locator('time')).toHaveAttribute('datetime', '2026-03-14T09:30:00.000Z');
    await expectAccessible(page, testInfo, 'a Galaxy clip, its facts');
    await keep(page, 'galaxy');
    expect(problems).toEqual([]);
  });

  test('VID_0001.mp4: from the Sample Cam app, no maker, filmed at 9:15, probably GMT+2', async ({
    page,
  }, testInfo) => {
    const problems = await watchProblems(page);
    await clip(page, CLIPS.appOnly);
    await expect(capture(page)).toContainText('From the Sample Cam app');
    await expect(capture(page)).not.toContainText('XC01');
    await expect(capture(page)).not.toContainText('Device');
    await expect(capture(page)).not.toContainText('Samsung');
    await expect(capture(page)).toContainText('Mar 14, 2026, 9:15');
    await expect(capture(page)).toContainText('Filmed probably at GMT+2, like the clips around it');
    await expectAccessible(page, testInfo, 'a camera app’s clip, its facts');
    await keep(page, 'app-only');
    expect(problems).toEqual([]);
  });

  test('an iPhone: its lens under its name, and the time in its own zone', async ({ page }) => {
    await clip(page, CLIPS.iphone);
    await expect(capture(page)).toContainText('Apple iPhone 16 Pro');
    await expect(capture(page)).toContainText('back triple camera 6.765mm f/1.78');
    await expect(capture(page)).toContainText('Filmed at GMT+5:30');
    await keep(page, 'iphone-lens');
  });

  test("an iPhone time-lapse: the phone's own name for the mode, as a mark", async ({ page }) => {
    await clip(page, CLIPS.timeLapse);
    await expect(capture(page)).toContainText('Time-lapse');
    await keep(page, 'iphone-time-lapse');
  });

  test.describe('at the smallest window, in the pseudo-locale and Hindi', () => {
    test.use({ viewport: { width: 1024, height: 720 } });
    for (const [name, id] of Object.entries(CLIPS))
      test(`${name}: everything translated, nothing clipped`, async ({ page }) => {
        await preferences(page, { locale: 'en-XA', theme: 'light' });
        await clip(page, id);
        const text = (await userFacingText(page, '[data-slot=clip-facts]')).filter(
          (found) => !found.where.endsWith('a > span @title'),
        );
        expect(englishShowing(text, englishPhrases()), 'English source strings on screen').toEqual([]);
        expect(untranslated(text), 'strings that skipped the catalogue').toEqual([]);
        expect(await clippedText(page), 'text that does not fit').toEqual([]);
        await preferences(page, { locale: 'hi', theme: 'dark' });
        await clip(page, id);
        await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
        expect(await clippedText(page), 'Hindi that does not fit').toEqual([]);
        if (SHOTS && name !== 'iphone')
          await page
            .locator('[data-slot=clip-facts]')
            .screenshot({ path: join(SHOTS, `${name}-hi-dark.png`) });
      });
  });
});
