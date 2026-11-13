// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The five Make cards (P2-M3, P2-M7, P2-M8, P2-M11) as the app shows them: every fixture state in the UI
// kit on the app's live data (the fakes' Golden hour market), none a placeholder, axe clean in light and
// dark; a swap from the cast board is a command the bus runs; and an export made in the chat's flow is a
// real render in Exports.
import { expect, test, type Page } from '@playwright/test';
import { reviewAndAnswer } from './review-support.ts';
import { axeFor, expectAccessible } from './axe.ts';
import { backend } from './backend-driver.ts';
import { fakeChat, open, preferences, watchProblems } from './support.ts';

const KIT = { name: 'dev-kit', path: '/dev/kit' };
const gallery = (page: Page) => page.locator('[data-slot=make-cards-gallery]');
const card = (page: Page, type: string) => gallery(page).locator(`[data-card-type=${type}]`);

test.describe('Make cards', () => {
  test.beforeEach(async ({ page }) => {
    await fakeChat(page, { latencyMs: 30, renderTickMs: 0 });
  });

  test('every state, none a placeholder, on the live Golden hour market', async ({ page }) => {
    const problems = await watchProblems(page);
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, KIT);
    await gallery(page).scrollIntoViewIfNeeded();
    await expect(gallery(page).locator('[data-pending]')).toHaveCount(0);
    for (const type of ['castBoard', 'timeline', 'qaReport', 'renderProgress', 'exportApproval'])
      await expect(card(page, type).first()).toBeVisible();
    // The cast board reads the fake's timelines: twelve slots, each with its pick and alternates.
    const board = gallery(page).locator('[data-fixture="castBoard/cast"]');
    // Six at first, the rest a press away.
    await expect(board.locator('[data-slot-id]')).toHaveCount(6, { timeout: 10_000 });
    await board.getByRole('button', { name: 'Show all 12 slots' }).click();
    await expect(board.locator('[data-slot-id]')).toHaveCount(12);
    // The render cards keep their fixture's state; the export card's preview plays the live timeline.
    await expect(
      gallery(page).locator('[data-fixture="renderProgress/failed"] [data-slot=render-progress]'),
    ).toHaveAttribute('data-status', 'failed');
    expect(problems).toEqual([]);
  });

  test('a swap on the cast board is timeline.swapClip from the person', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, KIT);
    const board = gallery(page).locator('[data-fixture="castBoard/cast"]');
    await board.scrollIntoViewIfNeeded();
    await board.locator('[data-alternate]').first().click();
    await expect
      .poll(async () => (await backend.dispatched(page)).filter((d) => d.name === 'timeline.swapClip'))
      .toEqual([{ name: 'timeline.swapClip', source: 'ui' }]);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`axe finds nothing on the gallery (${theme})`, async ({ page }, testInfo) => {
      await preferences(page, { theme, locale: 'en' });
      await open(page, KIT);
      await gallery(page).scrollIntoViewIfNeeded();
      await expect(card(page, 'castBoard').first()).toBeVisible();
      await expectAccessible(
        page,
        testInfo,
        `make cards gallery (${theme})`,
        axeFor(page).include('[data-slot=make-cards-gallery]'),
      );
    });
  }

  test('an export made in the chat is a real render in Exports', async ({ page }) => {
    await fakeChat(page, { latencyMs: 30, renderTickMs: 0, speed: 6 });
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, { name: 'renders', path: '/renders' });
    const before = await page.locator('[data-slot=render-row]').count();
    await open(page, { name: 'chat', path: '/chat' });
    await page.getByRole('button', { name: /Just describe it/ }).click();
    const box = page.getByRole('textbox').first();
    await box.fill('Make a 15 second reel from the Goa market, on the beat');
    await box.press('Enter');
    const exportCard = page.locator('[data-card-type=exportApproval]');
    await expect(exportCard).toBeVisible({ timeout: 40_000 });
    // UX4: the approval is made on its review page; Export comes back to the chat.
    await reviewAndAnswer(page, 'Export');
    await expect(exportCard).toHaveAttribute('data-status', 'exported', { timeout: 30_000 });
    // In the app, not a reload: the fakes live in the page.
    await page.getByRole('link', { name: 'Make', exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole('link', { name: 'Exports', exact: true }).first().click();
    await expect(page).toHaveURL(/\/renders$/);
    await expect(page.locator('[data-slot=render-row]')).toHaveCount(before + 2);
  });
});
