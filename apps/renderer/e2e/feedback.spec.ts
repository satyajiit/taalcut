// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P2-X7 "Done when" (the window's part): Send feedback from ⌘K and the Help menu, with an optional debug
// bundle (previewed before anything is written), saved or sent; refused under Local only with the save
// way out; the post-export survey only with usage counts on, and only once per export.
import { expect, test, type Page } from '@playwright/test';
import { reviewAndAnswer } from './review-support.ts';
import { backend } from './backend-driver.ts';
import { open, preferences } from './support.ts';
import { expectAccessible, expectPseudoClean, fakes, shoot } from './ui2b-support.ts';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Send feedback' });
const sent = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          taalcutFake: {
            feedback: { sent: { message: string; bundle: { includeChatText: boolean } | null }[] };
          };
        }
      ).taalcutFake.feedback.sent,
  );

async function openFromPalette(page: Page) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Send feedback');
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeVisible();
}

test('from ⌘K: words, a previewed bundle, Send, and a thank-you', async ({ page }, testInfo) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, { name: 'chat', path: '/chat' });
  await openFromPalette(page);
  // Nothing typed: Send says what's missing.
  await dialog(page).getByRole('button', { name: 'Send' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Write a few words first');
  await dialog(page).getByLabel('What happened, or what would you change?').fill('The export card froze.');
  await dialog(page).getByRole('switch', { name: 'Attach a debug bundle' }).click();
  const preview = dialog(page).getByRole('list', { name: 'In the bundle' });
  await expect(preview).toContainText('The agent’s recent runs');
  await expect(preview).toContainText('things replaced');
  await dialog(page).getByRole('switch', { name: 'Include what I typed and Taalcut’s replies' }).click();
  await expectAccessible(page, testInfo, 'feedback dialog (light)');
  await shoot(page, 'feedback-light');
  await dialog(page).getByRole('button', { name: 'Send' }).click();
  await expect(dialog(page).getByRole('status')).toHaveText('Sent. Thank you.');
  expect(await sent(page)).toEqual([
    { message: 'The export card froze.', bundle: expect.objectContaining({ includeChatText: true }) },
  ]);
  await dialog(page).getByRole('button', { name: 'Done' }).click();
  await expect(dialog(page)).toBeHidden();
});

test('from the Help menu, in dark: Save bundle… keeps it on this Mac', async ({ page }, testInfo) => {
  await preferences(page, { theme: 'dark', locale: 'en' });
  await open(page, { name: 'library', path: '/library' });
  await backend.menu(page, 'help.feedback');
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('switch', { name: 'Attach a debug bundle' }).click();
  await expect(dialog(page).getByRole('list', { name: 'In the bundle' })).toBeVisible();
  await expectAccessible(page, testInfo, 'feedback dialog (dark)');
  await shoot(page, 'feedback-dark');
  await dialog(page).getByRole('button', { name: 'Save bundle…' }).click();
  await expect(dialog(page)).toContainText('Saved as Taalcut feedback 2026-10-13.zip.');
  expect(await sent(page)).toEqual([]);
});

test('Local only: Send is off and says why; saving the bundle still works', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { localOnly: true });
  await open(page, { name: 'chat', path: '/chat' });
  await openFromPalette(page);
  await expect(dialog(page)).toContainText('Local only is on. Save the bundle and send it yourself.');
  await expect(dialog(page).getByRole('button', { name: 'Send' })).toBeDisabled();
  await dialog(page).getByRole('button', { name: 'Save bundle…' }).click();
  await expect(dialog(page)).toContainText('Saved as');
});

test('the dialog in the pseudo-locale: everything translated, nothing clipped', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en-XA' });
  await open(page, { name: 'chat', path: '/chat' });
  await backend.menu(page, 'help.feedback');
  await expect(page.locator('[data-slot=feedback-dialog]')).toBeVisible();
  await page.locator('[data-slot=feedback-dialog] [role=switch]').first().click();
  await expect(page.locator('[data-slot=bundle-preview]')).toBeVisible();
  await expectPseudoClean(page, 'feedback');
});

/** The scripted library flow, to the export card and through Export to the finished render. */
async function exportAVideo(page: Page) {
  await open(page, { name: 'chat', path: '/chat' });
  await page.getByRole('button', { name: /Use my library/ }).click();
  const exportCard = page.locator('[data-card-type=exportApproval]');
  await expect(exportCard).toBeVisible({ timeout: 30_000 });
  // UX4: the approval is made on its review page; Export comes back to the chat.
  await reviewAndAnswer(page, 'Export');
  // When the export is done the agent offers the ways in again, to make another.
  await expect(page.locator('[data-slot=opening-choices]')).toBeVisible({ timeout: 30_000 });
}

test('after an export, with usage counts on, “Would you post this?” is asked once', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { telemetry: true, speed: 20 });
  await exportAVideo(page);
  const survey = page.getByRole('group', { name: 'Would you post this?' });
  await expect(survey).toBeVisible();
  await survey.getByRole('button', { name: 'Yes' }).click();
  await expect(page.getByText('Thanks. That helps.')).toBeVisible();
  const recorded = await page.evaluate(
    () =>
      (
        window as unknown as {
          taalcutFake: { onboarding: { recorded: { name: string; answer?: string }[] } };
        }
      ).taalcutFake.onboarding.recorded,
  );
  expect(recorded).toContainEqual({ name: 'export.survey', answer: 'yes' });
  // Back to the chat later: the same export doesn't ask again.
  const chat = page.url();
  await page.getByRole('link', { name: 'Library' }).click();
  await page.goBack();
  await expect(page).toHaveURL(chat);
  await expect(page.locator('[data-card-type=renderProgress]').last()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Would you post this?' })).toHaveCount(0);
});

test('with usage counts off, the survey never shows', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await fakes(page, { speed: 20 });
  await exportAVideo(page);
  await expect(page.getByRole('group', { name: 'Would you post this?' })).toHaveCount(0);
});
