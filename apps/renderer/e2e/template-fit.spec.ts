// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-TPL: templates that fit the footage, on screen over the fake's timelines.fitTemplates (fake-fit.ts). The
// import card (dev kit fixtures) lists the best three once clips are searchable, with how much each fills, how close
// the match is and what it is short of; the chat start's "Start from a template" sorts the saved templates by the
// best fit for a source, from the keyboard too. A read that fails says so with Try again, and an import none of
// whose clips can be matched yet says that. Each in light and dark, axe-clean, and in the pseudo-locale with
// nothing left in English or clipped. Screenshots go to e2e-artifacts/screens/template-fit/ (or $TAALCUT_TPL_SCREENS).
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { clippedText, englishPhrases, englishShowing, untranslated, userFacingText } from './inspect.ts';
import { ARTIFACTS, fakeChat, open, preferences } from './support.ts';

const SCREENS = process.env.TAALCUT_TPL_SCREENS ?? new URL('screens/template-fit/', ARTIFACTS).pathname;
const shot = (theme: string, name: string) => `${SCREENS.replace(/\/?$/, '/')}${theme}/${name}.png`;
const KIT = { name: 'dev-kit', path: '/dev/kit' };
const CHAT = { name: 'chat', path: '/chat' };

/** The fakes with an import held still, and the fit scenario when one is given. */
const fakes = (page: Page, fit?: 'noShots' | 'failing') =>
  fakeChat(page, { indexingTickMs: 0, ...(fit ? { fit } : {}) });

const importCard = (page: Page, state: string) =>
  page.locator(`figure[data-fixture="importProgress · ${state}"]`);
const fitSection = (page: Page, state: string) =>
  importCard(page, state).getByRole('region', { name: 'Templates that fit this footage' });
const fitRows = (page: Page, state: string) => fitSection(page, state).locator('[data-slot=fit-row]');

async function openTemplates(page: Page) {
  await open(page, CHAT);
  await page.locator('li[data-path="template"] > button').click();
  await expect(page.getByRole('list', { name: 'Your templates' })).toBeVisible();
}

const savedNames = (page: Page) =>
  page.getByRole('list', { name: 'Your templates' }).locator('button [translate=no]').allTextContents();

for (const theme of ['light', 'dark'] as const) {
  test.describe(`templates that fit, ${theme}`, () => {
    test('the import card lists the best three the clips fill', async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakes(page);
      await open(page, KIT);
      for (const state of ['indexing', 'done']) {
        await importCard(page, state).scrollIntoViewIfNeeded();
        await expect(fitRows(page, state)).toHaveCount(3);
        const first = fitRows(page, state).first();
        await expect(first.locator('[data-slot=fit-facts]')).toHaveText(
          /^\d+% match · Fills (all \d+ slots|\d+ of \d+ slots)$/,
        );
        // The kit has no chat to start a video in: the rows only inform (Make it is the chat's, unit-tested).
        await expect(fitSection(page, state).getByRole('button')).toHaveCount(0);
        await importCard(page, state).screenshot({ path: shot(theme, `import-card-${state}`) });
      }
      // A row short of slots names what it misses, the slot's intent as the template wrote it.
      await expect(fitSection(page, 'indexing').locator('[data-slot=fit-missing] li').first()).toHaveText(
        /^(Missing slot \d+: .+ \(.+\)|and \d+ more slots?)$/,
      );
      // A paused import's searchable clips fit too.
      await expect(fitRows(page, 'paused')).toHaveCount(3);
      await expectAccessible(page, testInfo, `import cards with fits (${theme})`);
    });

    test('the template picker sorts by the best fit for a source', async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await fakes(page);
      await openTemplates(page);
      const newest = await savedNames(page);
      const sort = page.getByRole('combobox', { name: 'Sort by' });
      await expect(sort).toHaveValue('');
      await expect(page.locator('[data-slot=fit-facts]')).toHaveCount(0);
      await page.screenshot({ path: shot(theme, 'picker-newest') });

      await sort.selectOption({ label: 'Best fit for Goa trip' });
      await expect(page.locator('[data-slot=fit-facts]')).toHaveCount(newest.length);
      const fitted = await savedNames(page);
      expect([...fitted].sort()).toEqual([...newest].sort());
      await page.screenshot({ path: shot(theme, 'picker-best-fit') });
      await expectAccessible(page, testInfo, `template picker sorted by fit (${theme})`);

      await sort.selectOption({ label: 'Newest first' });
      await expect(page.locator('[data-slot=fit-facts]')).toHaveCount(0);
      expect(await savedNames(page)).toEqual(newest);

      // The best fit starts like any saved template: its sentence goes out as the person's message.
      await sort.selectOption({ label: 'Best fit for Goa trip' });
      const best = fitted[0] ?? '';
      await page.getByRole('list', { name: 'Your templates' }).getByRole('button').first().click();
      await expect(page.getByText(`Make a video with my template “${best}”`).first()).toBeVisible();
    });
  });
}

test('keyboard: the sort comes first in the template panel and changes from the keys', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page);
  await openTemplates(page);
  const sort = page.getByRole('combobox', { name: 'Sort by' });
  await page.locator('li[data-path="template"] > button').focus();
  await page.keyboard.press('Tab');
  await expect(sort).toBeFocused();
  // Type-ahead picks the first "Best fit for …" (arrow keys open the menu on macOS instead).
  await page.keyboard.press('b');
  await expect(sort).not.toHaveValue('');
  await expect(page.locator('[data-slot=fit-facts]').first()).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('list', { name: 'Your templates' }).getByRole('button').first()).toBeFocused();
});

test('a fit that fails says so with Try again; nothing matchable yet says that', async ({
  page,
}, testInfo) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, 'failing');
  await open(page, KIT);
  const failing = fitSection(page, 'indexing');
  await failing.scrollIntoViewIfNeeded();
  await expect(failing.getByRole('alert')).toBeVisible();
  await expect(failing.getByRole('button', { name: 'Try again' })).toBeVisible();
  await failing.screenshot({ path: shot('light', 'import-card-fit-failed') });
  await expectAccessible(page, testInfo, 'import card, fit failed');

  // A later init script wins: the next load runs the noShots fake.
  await fakes(page, 'noShots');
  await open(page, KIT);
  const waiting = fitSection(page, 'indexing');
  await waiting.scrollIntoViewIfNeeded();
  await expect(waiting).toContainText(
    'None of these clips can be matched yet. This fills in as they become searchable.',
  );
  await waiting.screenshot({ path: shot('light', 'import-card-fit-no-shots') });
});

test.describe('templates that fit, pseudo-locale', () => {
  test.use({ viewport: { width: 1024, height: 720 } });
  const phrases = englishPhrases();

  test('nothing in English or clipped on the card or the sorted picker', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en-XA' });
    await fakes(page);
    const check = async (name: string) => {
      const text = await userFacingText(page);
      expect(englishShowing(text, phrases), `${name}: English source strings on screen`).toEqual([]);
      expect(untranslated(text), `${name}: strings that skipped the catalogue`).toEqual([]);
      expect(await clippedText(page), `${name}: text that does not fit`).toEqual([]);
      await page.screenshot({ path: shot('pseudo', name) });
    };
    await open(page, KIT);
    await importCard(page, 'indexing').scrollIntoViewIfNeeded();
    await expect(importCard(page, 'indexing').locator('[data-slot=fit-row]')).toHaveCount(3);
    await check('import-card');

    await open(page, CHAT);
    await page.locator('li[data-path="template"] > button').click();
    const sort = page.locator('[data-slot=fit-order] select');
    await expect(sort).toBeVisible();
    await sort.selectOption({ index: 1 });
    await expect(page.locator('[data-slot=fit-facts]').first()).toBeVisible();
    await check('picker-best-fit');
  });
});
