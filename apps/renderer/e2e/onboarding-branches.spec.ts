// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B3 "Done when" (the automated part): every first-run branch works from a clean profile in each of the four
// app languages and the pseudo-locale. The four ways to think (ChatGPT; another subscription only after its
// warning; an API key that is tested; Local only, with its two person commands), asked on the last step when
// nothing can think yet (UX4); the four ways to bring videos in (a folder, the phone over Wi-Fi, the phone on a
// cable, later), each import shown on the same step; and the three ways to start (a starter, a reel, a
// description), each started by Make my first video. Controls are found by their data hooks, so nothing here
// depends on the words.
import { expect, test, type Page } from '@playwright/test';
import { preferences } from './support.ts';
import { expectPseudoClean, fakes, type Ui2bFakeOptions } from './ui2b-support.ts';
import {
  action,
  atStep,
  carryOn,
  commandNames,
  connect,
  expectDispatched,
  FIRST_RUN_LOCALES,
  makeIt,
  openTheWays,
  openWay,
  panel,
  progress,
  startImport,
  type FirstRunLocale,
} from './onboarding-support.ts';

async function start(page: Page, locale: FirstRunLocale, step: string, options: Ui2bFakeOptions = {}) {
  await preferences(page, { theme: 'light', locale });
  await fakes(page, { onboarding: 'fresh', channel: 'stable', library: 'empty', ...options });
  if (page.url().startsWith('http'))
    await page.evaluate(() => localStorage.removeItem('taalcut.fake.imports'));
  await page.goto(`/onboarding/${step}`);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('h1')).toBeVisible();
}

/** In the pseudo-locale, nothing on the step may be English or clipped. */
async function wordsChecked(page: Page, locale: FirstRunLocale, label: string) {
  if (locale === 'en-XA') await expectPseudoClean(page, label);
}

// A choice is saved by a command the step doesn't wait for, so the next step can show before it lands (IX3-F11):
// the stored branch is polled, never read once.
const branchOf = async (page: Page) => (await progress(page)).branch;

/** Nothing can think yet: the last step's moment, its ways open. */
async function waysToThink(page: Page, locale: FirstRunLocale) {
  await start(page, locale, 'first-video');
  await openTheWays(page);
}
const asking = (page: Page) => page.locator('[data-slot=quiet-check]');

for (const locale of FIRST_RUN_LOCALES) {
  test.describe(`first run in ${locale}`, () => {
    test('the four ways to think each reach a working model', async ({ page }) => {
      // Continue with ChatGPT: the browser sign-in, then the plan.
      await waysToThink(page, locale);
      await expect(action(page, 'make-first-video')).toBeDisabled();
      await openWay(page, 'chatgpt');
      await action(page, 'chatgpt-sign-in').click();
      await expect(asking(page)).toHaveCount(0);
      await wordsChecked(page, locale, 'first video, ChatGPT signed in');
      await expect.poll(() => branchOf(page)).toMatchObject({ thinking: 'chatgpt' });

      // Another subscription: nothing signs in before the warning's "I understand".
      await waysToThink(page, locale);
      await openWay(page, 'subscription');
      await panel(page, 'subscription').locator('button[data-provider]').first().click();
      await expect(action(page, 'acknowledge')).toBeVisible();
      await wordsChecked(page, locale, 'first video, the subscription warning');
      await expect(asking(page)).toHaveCount(1);
      await action(page, 'acknowledge').click();
      await expect(asking(page)).toHaveCount(0);
      await expect.poll(() => branchOf(page)).toMatchObject({ thinking: 'subscription' });

      // An API key: a bad one says so, a good one works.
      await waysToThink(page, locale);
      await openWay(page, 'api-key');
      const key = panel(page, 'api-key').locator('input[type=password]');
      await key.fill('sk-bad-123');
      await action(page, 'test-key').click();
      await expect(panel(page, 'api-key').getByRole('alert')).toBeVisible();
      await expect(asking(page)).toHaveCount(1);
      await key.fill('sk-good-123');
      await action(page, 'test-key').click();
      await expect(asking(page)).toHaveCount(0);
      await wordsChecked(page, locale, 'first video, a key that works');
      await expect.poll(() => branchOf(page)).toMatchObject({ thinking: 'api-key' });

      // Local only: its two person commands, and what it means on this Mac.
      await waysToThink(page, locale);
      await openWay(page, 'local-only');
      await action(page, 'local-only').click();
      await expect(asking(page)).toHaveCount(0);
      expect(await commandNames(page)).toEqual(
        expect.arrayContaining(['privacy.setLocalOnly', 'models.setProfile']),
      );
      await wordsChecked(page, locale, 'first video, Local only on');
      await expect.poll(() => branchOf(page)).toMatchObject({ thinking: 'local-only' });
    });

    test('the four ways to bring videos in', async ({ page }) => {
      // A folder: chosen, added, and its import shows on the same step.
      await start(page, locale, 'sources');
      await openWay(page, 'folder');
      await startImport(page);
      await expect(action(page, 'continue')).toBeEnabled();
      await expect(
        page
          .locator('section[aria-label] [data-action=start-import]')
          .or(page.locator('a[href^="/library/imports/"]')),
      ).toBeVisible();
      await wordsChecked(page, locale, 'sources, a folder coming in');

      // The phone over Wi-Fi: the walkthrough and the code; the first file arriving enables Continue.
      await start(page, locale, 'sources', { transfer: 'phone' });
      await openWay(page, 'wifi');
      await action(page, 'wifi-connect').click();
      // The Wi-Fi screen's own steps beside the QR are the walkthrough: one list, said once.
      await expect(panel(page, 'wifi').locator('[data-slot="pairing"]')).toBeVisible();
      await expect(panel(page, 'wifi').locator('ol')).toHaveCount(1);
      await expect(action(page, 'continue')).toBeEnabled({ timeout: 20_000 });
      await wordsChecked(page, locale, 'sources, the phone over Wi-Fi');
      await expect.poll(() => branchOf(page)).toMatchObject({ source: 'wifi' });

      // The phone on a cable: found, opened, the last 30 days imported in the background.
      await start(page, locale, 'sources', { usb: 'iphone', usbTickMs: 150 });
      await openWay(page, 'cable');
      await startImport(page);
      await expect(action(page, 'continue')).toBeEnabled();
      await wordsChecked(page, locale, 'sources, a cable import');
      await expect.poll(() => branchOf(page)).toMatchObject({ source: 'cable' });
      await carryOn(page);
      await atStep(page, 'first-video');

      // No phone, no folder yet: straight to the first video.
      await start(page, locale, 'sources');
      await action(page, 'later').click();
      await atStep(page, 'first-video');
      // Saved in the order chosen (the branch, at sources; then the step): a resume opens the first video. The
      // other order would leave the stored step at sources, and this would never hold.
      await expect
        .poll(() => progress(page))
        .toMatchObject({ step: 'first-video', branch: { source: 'later' } });
    });

    test('the three ways to start the first video', async ({ page }) => {
      // A starter: the best fit chosen for you, forked, and the chat opens with it.
      await start(page, locale, 'first-video', { library: 120, localOnly: true });
      await page.locator('li[data-path="template"] > button').click();
      await expect(page.locator('[data-starter]').first()).toHaveAttribute('data-starter', 'weekend-trip');
      await expect(page.locator('[data-starter="weekend-trip"] input')).toBeChecked();
      await wordsChecked(page, locale, 'first video, the starters');
      await makeIt(page);
      await expect(page).toHaveURL(/\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/);
      await expectDispatched(page, 'template.addStarter');

      // Just describe it.
      await start(page, locale, 'first-video', { localOnly: true });
      await page.locator('li[data-path="describe"] > button').click();
      // An open way's panel is a row of its own right after the tiles (UX1).
      const describe = page.locator('li[data-panel-for="describe"]');
      await describe.locator('textarea').fill('A 30 second reel of my weekend');
      await makeIt(page);
      await expect(page).toHaveURL(/\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/);
      expect((await progress(page)).completedAt).not.toBeNull();

      // Paste a reel: the link starts the reference flow in the chat (its warning is the chat's). A link needs a
      // way to think that isn't Local only: ChatGPT, from the moment.
      await start(page, locale, 'first-video');
      await connect(page);
      await page.locator('li[data-path="reference"] > button').click();
      const reel = page.locator('li[data-panel-for="reference"]');
      await reel.locator('input[type=url]').fill('https://www.instagram.com/reel/C1a2b3c4d5/');
      await wordsChecked(page, locale, 'first video, a reel');
      await makeIt(page);
      await expect(page).toHaveURL(/\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/);
    });
  });
}
