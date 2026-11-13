// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P2-M13 "Done when" (the window's part): on the scripted flow, an opening choice leads through the
// breakdown, the cost estimates, the casting, the cut and the check to the one approval, and Export to a
// finished render (UX4: the approval is made on the chat's review page, and Export comes back to the chat); a slot changed while it waits sends the export card back to
// "updating" and the approval comes back. P2-X1: the budget cap stops a step and only the person goes on.
// Light, dark and en-XA, axe at the cards.
import { expect, test, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { openReview, reviewAndAnswer, CHAT_URL } from './review-support.ts';
import { open, preferences } from './support.ts';
import { expectAccessible, expectPseudoClean, fakes, shoot } from './ui2b-support.ts';

const REEL = 'https://www.instagram.com/reel/C9xYz12AbCd/';
const card = (page: Page, type: string) => page.locator(`[data-card-type=${type}]`);
const exportCard = (page: Page) => card(page, 'exportApproval');

/** Paste a reel from the start surface: it goes at once (REF1: no download warning), and the flow starts. */
async function startFromReel(page: Page) {
  await open(page, { name: 'chat', path: '/chat' });
  await page.getByRole('button', { name: /Paste a reel/ }).click();
  await expect(page.getByLabel('Link to a reel')).toBeFocused();
  await page.getByLabel('Link to a reel').fill(REEL);
  await page.getByRole('button', { name: 'Read this reel' }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/);
  await expect(page.locator('[data-slot=chat-message][data-role=user]').first()).toContainText(
    'Make a video like this reel',
  );
}

for (const theme of ['light', 'dark'] as const) {
  test(`a reel to a finished export, all in the chat (${theme})`, async ({ page }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    await fakes(page, { speed: 6 });
    await startFromReel(page);

    // The estimate goes ahead without waiting, by model, then says what it cost.
    const cost = card(page, 'costEstimate').first();
    await expect(cost).toContainText('Read the reel');
    const breakdown = card(page, 'breakdown');
    await expect(breakdown.getByRole('button', { name: 'Review the reel' })).toBeVisible({ timeout: 20_000 });
    await expectAccessible(page, testInfo, `breakdown (${theme})`);

    await expect(exportCard(page)).toBeVisible({ timeout: 30_000 });
    await expect(exportCard(page)).toContainText('Ready to export');
    await expect(page.getByText('Waiting for your answer.')).toBeVisible();
    await expectAccessible(page, testInfo, `export card (${theme})`);
    await shoot(page, `flow-export-${theme}`);

    // The review page: the video first, Export under it, the rest behind Options.
    await openReview(page);
    await expectAccessible(page, testInfo, `review page (${theme})`);
    await shoot(page, `flow-review-${theme}`);
    await page.locator('[data-slot=review-bar]').getByRole('button', { name: 'Export', exact: true }).click();
    // Back in the chat, which went on while you were away.
    await expect(page).toHaveURL(CHAT_URL);
    await expect(page.locator('[data-slot=opening-choices]')).toBeVisible({ timeout: 30_000 });
    await expect(exportCard(page)).toHaveAttribute('data-status', 'exported');
    await expectAccessible(page, testInfo, `exported (${theme})`);
    await shoot(page, `flow-done-${theme}`);
  });
}

test('a slot changed while the export waits: the card updates, the approval comes back', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { speed: 6 });
  await startFromReel(page);
  await expect(exportCard(page)).toHaveAttribute('data-status', 'pending', { timeout: 30_000 });

  // BRK1-REV: the card is a summary; the slot is changed in the review over the chat.
  await card(page, 'breakdown').getByRole('button', { name: 'Review the reel' }).click();
  const sheet = page.locator('[data-slot=review-sheet]');
  const slots = sheet.getByRole('listbox', { name: 'Slots' }).getByRole('option');
  await slots.nth(3).click();
  await page.keyboard.press('Enter');
  const name = page.getByRole('textbox', { name: 'Name for slot 4' });
  await name.fill('Chai pour');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await backend.dispatched(page)).at(-1))
    .toEqual({
      name: 'template.slot.rename',
      source: 'ui',
    });

  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(exportCard(page)).toHaveAttribute('data-status', /updating|pending/);
  await expect(exportCard(page)).toHaveAttribute('data-status', 'pending', { timeout: 20_000 });
  await expect(page.getByText('Updated with your change and checked again.')).toBeVisible();
  await reviewAndAnswer(page, 'Export');
  await expect(exportCard(page)).toHaveAttribute('data-status', /exporting|exported/);
});

test('Not now: the export waits for another day, nothing is exported', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { speed: 6 });
  await startFromReel(page);
  await expect(exportCard(page)).toHaveAttribute('data-status', 'pending', { timeout: 30_000 });
  await reviewAndAnswer(page, 'Not now');
  await expect(exportCard(page)).toHaveAttribute('data-status', 'declined');
});

test.describe('the project budget', () => {
  test.beforeEach(async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await fakes(page, { speed: 6, budget: 'cap' });
  });

  async function atTheCap(page: Page) {
    await open(page, { name: 'chat', path: '/chat' });
    await page.getByRole('button', { name: /Use my library/ }).click();
    const cap = card(page, 'budgetCap');
    await expect(cap).toBeVisible({ timeout: 30_000 });
    await expect(cap).toContainText('This would go over this project’s budget');
    return cap;
  }

  test('raising the cap is the person’s command, then the step goes on', async ({ page }, testInfo) => {
    const cap = await atTheCap(page);
    await expectAccessible(page, testInfo, 'budget cap');
    await shoot(page, 'flow-budget-cap-light');
    await cap.getByLabel('Raise the cap to').fill('1');
    await cap.getByRole('button', { name: 'Raise and go on' }).click();
    await expect(cap.getByRole('alert')).toContainText('Enter more than');
    await cap.getByLabel('Raise the cap to').fill('3');
    await cap.getByRole('button', { name: 'Raise and go on' }).click();
    await expect(cap.getByRole('status')).toContainText('Raised to $3.00');
    const ran = (await backend.dispatched(page)).map((d) => d.name);
    expect(ran).toContain('project.setBudgetCap');
    await expect(exportCard(page)).toBeVisible({ timeout: 30_000 });
  });

  test('a cheaper model instead, or stop where it is', async ({ page }) => {
    const cap = await atTheCap(page);
    // The free one on this Mac is listed first.
    await cap.getByRole('button', { name: 'Use this' }).first().click();
    await expect(cap.getByRole('status')).toContainText('Switched to');
    expect((await backend.dispatched(page)).map((d) => d.name)).toContain('models.setModuleOverride');

    const again = await atTheCap(page);
    await again.getByRole('button', { name: 'Stop here' }).click();
    await expect(again.getByRole('status')).toContainText('Stopped at your budget');
  });
});

test('the flow in the pseudo-locale: everything translated, nothing clipped', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en-XA' });
  await fakes(page, { speed: 6 });
  await page.setViewportSize({ width: 1024, height: 720 });
  await open(page, { name: 'chat', path: '/chat' });
  await expectPseudoClean(page, 'start surface');
  await page
    .getByRole('list')
    .filter({ has: page.locator('[data-path=library]') })
    .locator('[data-path=library] button')
    .click();
  await expect(exportCard(page)).toBeVisible({ timeout: 30_000 });
  await expectPseudoClean(page, 'flow at the export card');
});
