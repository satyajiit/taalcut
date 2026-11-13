// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1-IMPORT: the import strip's failed, ended, waiting, stopped and load-error states on the library page. The
// fake's phone import runs with 2 files that couldn't be read; other states are sent as the library would send
// them. See which opens the failed filter and lists each file with why; Show all clips closes it. Each in light
// and dark (axe-clean), at 1280 and 1024 px, and in the pseudo-locale and Hindi with nothing clipped or left in
// English. Screenshots go to e2e-artifacts/screens/import-failed/ (or $TAALCUT_IMPORT_SCREENS), prefixed by
// $TAALCUT_IMPORT_PREFIX (default "after").
import type { ImportStatus, IndexingStatus } from '@taalcut/core';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { clippedText, englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { ARTIFACTS, fakeChat, open, preferences } from './support.ts';

const SCREENS = process.env.TAALCUT_IMPORT_SCREENS ?? new URL('screens/import-failed/', ARTIFACTS).pathname;
const PREFIX = process.env.TAALCUT_IMPORT_PREFIX ?? 'after';
const shot = (name: string) => `${SCREENS.replace(/\/?$/, '/')}${PREFIX}-${name}.png`;

const strip = (page: Page) => page.locator('[data-slot=import-strip]');

declare global {
  interface Window {
    /** The fake backend's controls (src/backend/fake/expose.ts): the part this spec uses. */
    taalcutFake?: {
      events: { emit(name: string, payload: unknown): void };
      library: { indexing: { status(): IndexingStatus } };
    };
  }
}

/** The fake's controls, in the page: every test here runs on the fake backend. */
function fakeIn(page: Page) {
  return page.evaluateHandle(() => {
    if (!window.taalcutFake) throw new Error('the fake backend is not running');
    return window.taalcutFake;
  });
}

/** The phone import's status as the fake has it now, changed by `edit`, sent as the library would send it. */
async function sendStatus(page: Page, edit: (source: ImportStatus) => ImportStatus): Promise<void> {
  const fake = await fakeIn(page);
  const now = await fake.evaluate((controls) => controls.library.indexing.status());
  const [first] = now.sources;
  if (!first) throw new Error('the fake has no import running');
  await fake.evaluate((controls, status) => controls.events.emit('library.indexing', status), {
    ...now,
    sources: [edit(first)],
  });
}

/** Ended: 118 of 120 phone clips in, 2 files that couldn't be read. */
const ended = (source: ImportStatus): ImportStatus => ({
  ...source,
  state: 'failed',
  counts: { assets: 120, done: 118, active: 0, waiting: 0, failed: 2, searchable: 118 },
  etaMs: null,
  jobIds: [],
});

/** What the PO's two phone clips read like now: in, with speech and search waiting for their models. */
const waiting = (source: ImportStatus): ImportStatus => ({
  ...source,
  state: 'indexing',
  counts: { assets: 2, done: 0, active: 0, waiting: 2, failed: 0, searchable: 0 },
  stages: [
    { stage: 'media.normalise', done: 2, left: 0, failed: 0, milestone: 'searchable' },
    { stage: 'audio.language', done: 0, left: 2, failed: 0, milestone: 'searchable' },
  ],
  etaMs: null,
  jobIds: [],
});

/** A scan that stopped, with no failed files. */
const stopped = (source: ImportStatus): ImportStatus => ({
  ...source,
  state: 'failed',
  counts: { ...source.counts, active: 0, waiting: 0, failed: 0 },
  etaMs: null,
  jobIds: [],
});

/** How many failed files the open list accounts for: those it shows and the "And N more". */
async function listedTotal(list: Locator): Promise<number> {
  const shown = await list.locator('[data-slot=import-failed-file]').count();
  return shown + Number(/And (\d+) more/.exec(await list.innerText())?.[1] ?? 0);
}

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1024, height: 720 },
] as const;

for (const theme of ['light', 'dark'] as const) {
  test.describe(`the import strip, ${theme}`, () => {
    test('says what failed and why, and See which lists each file', async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { indexingTickMs: 0 });
      await open(page, { name: 'library', path: '/library' });

      // The fake's phone import: 2 files that couldn't be read, and older clips of the phone whose analysis stopped.
      // The line counts them ("files need a look"); Details opens the rest under it (UX4, B12).
      await expect(strip(page).locator('[data-slot=import-needs-look]')).toBeVisible();
      await strip(page).getByRole('button', { name: 'Details' }).click();
      const line = strip(page).locator('[data-slot=import-failed]');
      await expect(line).toContainText(/2 (files|videos|photos) couldn’t be read\./);
      await expect(line).toContainText('They may be damaged or in a format Taalcut doesn’t read yet.');
      await expect(line).toContainText(/Taalcut couldn’t finish analysing \d+ clips\. They play as usual/);
      await expect(line.getByRole('button', { name: 'Leave them out' })).toBeVisible();
      await expectAccessible(page, testInfo, `strip with failed files (${theme})`);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await strip(page).screenshot({ path: shot(`strip-partial-${theme}-${size.width}`) });
      }
      const analysing = Number(/finish analysing (\d+) clips/.exec(await line.innerText())?.[1]);

      await line.getByRole('button', { name: 'See which' }).click();
      await expect(page).toHaveURL(/filter=failed/);
      const list = strip(page).locator('[data-slot=import-failed-list]');
      const reasons = list.locator('[data-slot=import-failed-file] p + p');
      // Newest first: the import's two unreadable files lead, each with the library's reason in words.
      await expect(reasons.nth(0)).toHaveText(/couldn’t read this file|in a format Taalcut doesn’t read yet/);
      await expect(reasons.nth(1)).toHaveText(/couldn’t read this file|in a format Taalcut doesn’t read yet/);
      await expect(list).toContainText('“Finding shots” didn’t finish. The clip plays as usual.');
      // The list accounts for every file the line counts.
      expect(await listedTotal(list)).toBe(2 + analysing);
      const hide = line.getByRole('button', { name: 'Show all clips' });
      await expect(hide).toHaveAttribute('aria-expanded', 'true');
      await expectAccessible(page, testInfo, `failed files listed (${theme})`);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await strip(page).screenshot({ path: shot(`strip-see-which-${theme}-${size.width}`) });
        await page.screenshot({ path: shot(`library-see-which-${theme}-${size.width}`) });
      }

      await hide.click();
      await expect(page).not.toHaveURL(/filter=failed/);
      await expect(list).toHaveCount(0);
    });

    test('Leave them out takes only the files that couldn’t be read, with Undo', async ({ page }) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { indexingTickMs: 0 });
      await open(page, { name: 'library', path: '/library?filter=failed' });
      const line = strip(page).locator('[data-slot=import-failed]');
      const list = strip(page).locator('[data-slot=import-failed-list]');
      await expect(list.locator('[data-slot=import-failed-file]').first()).toBeVisible();
      const before = await listedTotal(list);

      await line.getByRole('button', { name: 'Leave them out' }).click();
      const toast = page.locator('[data-slot=toast]').filter({ hasText: 'Left 2 files out of your library' });
      await expect(toast).toBeVisible();
      // The clips that play stay; only the unreadable files leave the line and the list.
      await expect(line).not.toContainText('couldn’t be read');
      await expect(line).toContainText('couldn’t finish analysing');
      await expect.poll(() => listedTotal(list)).toBe(before - 2);
      await page.setViewportSize({ width: 1024, height: 720 });
      await strip(page).screenshot({ path: shot(`strip-left-out-${theme}-1024`) });

      await toast.getByRole('button', { name: 'Undo' }).click();
      await expect(line).toContainText(/2 (files|videos|photos) couldn’t be read\./);
      await expect.poll(() => listedTotal(list)).toBe(before);
    });

    test('ended, waiting and stopped imports say what happened and what to do', async ({
      page,
    }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { indexingTickMs: 0 });
      await open(page, { name: 'library', path: '/library' });
      await expect(strip(page)).toBeVisible();

      await sendStatus(page, ended);
      // The line says what happened; Details holds the files and what to do with them (UX4, B12).
      await expect(strip(page)).toHaveAttribute('data-kind', 'attention');
      await expect(strip(page)).toContainText('Clips from iPhone 16 Pro are in');
      await expect(strip(page)).not.toContainText('stopped');
      await expect(strip(page).getByRole('progressbar')).toHaveCount(0);
      await strip(page).getByRole('button', { name: 'Details' }).click();
      const progress = strip(page).locator('[data-slot=import-progress]');
      await expect(progress).toHaveAttribute('data-outcome', 'ended-with-failures');
      await expectAccessible(page, testInfo, `ended with failures (${theme})`);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await strip(page).screenshot({ path: shot(`strip-ended-${theme}-${size.width}`) });
        await page.screenshot({ path: shot(`library-ended-${theme}-${size.width}`) });
      }

      await sendStatus(page, waiting);
      await expect(strip(page)).toHaveAttribute('data-kind', 'waiting');
      await expect(progress).toHaveAttribute('data-outcome', 'waiting');
      await expect(progress).toContainText('The rest waits for a model to finish downloading.');
      await expect(strip(page).locator('.animate-spin')).toHaveCount(0);
      await expect(strip(page).getByRole('button', { name: 'Pause' })).toHaveCount(0);
      await expectAccessible(page, testInfo, `waiting for a model (${theme})`);
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await strip(page).screenshot({ path: shot(`strip-waiting-${theme}-${size.width}`) });
      }

      await sendStatus(page, stopped);
      // A stopped import is Kaatu's failure moment: what stopped, why, and Try again.
      const moment = strip(page).locator('[data-slot=kaatu-moment][data-tone=failure]');
      await expect(moment).toContainText('The import from iPhone 16 Pro stopped before it finished.');
      await expect(moment).toContainText(/connected|.+\./);
      await expect(strip(page).getByRole('button', { name: 'Try again' })).toBeVisible();
      await strip(page).screenshot({ path: shot(`strip-stopped-${theme}-1024`) });

      await sendStatus(page, waiting);
      await progress.getByRole('button', { name: 'See models' }).click();
      await expect(page).toHaveURL(/\/settings\/models$/);
    });

    test('a status that could not be read says so, with Try again', async ({ page }) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { indexingTickMs: 0 });
      await open(page, { name: 'library', path: '/library' });
      await (
        await fakeIn(page)
      ).evaluate((fake) => {
        const real = fake.library.indexing.status;
        // The page's read and the strip's own late read both fail; Try again reads it.
        let failures = 2;
        fake.library.indexing.status = () => {
          if (failures > 0) {
            failures -= 1;
            throw new Error('the jobs process went away');
          }
          return real();
        };
      });
      // Leave the library and come back in the page: the strip asks for the status again. Templates must land
      // first: a Library click while /templates is still pending cancels that navigation, so the library page is
      // never left and keeps its first status.
      await page.getByRole('link', { name: 'Templates' }).first().click();
      await expect(page.locator('[data-slot=templates]')).toBeVisible();
      await expect(strip(page)).toHaveCount(0);
      await expect(page.locator('[data-slot=global-loader]')).toHaveCount(0);
      await page.getByRole('link', { name: 'Library' }).first().click();
      const error = page.locator('[data-slot=import-strip][data-state=error]');
      await expect(error).toContainText('Taalcut couldn’t check on your imports');
      await error.screenshot({ path: shot(`strip-load-error-${theme}`) });
      await error.getByRole('button', { name: 'Try again' }).click();
      await expect(strip(page).locator('[data-slot=import-progress]')).toBeVisible();
    });
  });
}

for (const locale of ['en-XA', 'hi'] as const) {
  test(`nothing clipped or left in English on the strip, ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await preferences(page, { theme: 'light', locale });
    await fakeChat(page, { indexingTickMs: 0 });
    await open(page, { name: 'library', path: '/library?filter=failed' });
    const check = async (name: string) => {
      // Only the strip's own words: the sidebar's chat titles are the user's, outside this lane.
      const inStrip = await strip(page).innerText();
      const text = (await userFacingText(page)).filter((found) => inStrip.includes(found.text));
      if (locale === 'en-XA') {
        expect(englishShowing(text, englishPhrases()), `${name}: English on screen`).toEqual([]);
        expect(untranslated(text), `${name}: strings that skipped the catalogue`).toEqual([]);
      }
      expect(await clippedText(page, '[data-slot=import-strip] *'), `${name}: clipped`).toEqual([]);
      await strip(page).screenshot({ path: shot(`strip-${name}-${locale}`) });
    };
    await expect(strip(page).locator('[data-slot=import-failed-file]').first()).toBeVisible();
    await check('see-which');
    await sendStatus(page, ended);
    await check('ended');
    await sendStatus(page, waiting);
    await check('waiting');
  });
}
