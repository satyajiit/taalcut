// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P1-D5 crash-recovery prompt: nothing to recover means no prompt; a library
// restored from a backup is explained; an unfinished agent run can be resumed.
// The fake recovery client picks its report from localStorage `taalcut.fake`.
import { expect, test } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { clippedText, untranslated, userFacingText } from './inspect.ts';
import { fakeChat, open, preferences, screenshotWhole, watchProblems } from './support.ts';

const CHAT = { name: 'chat', path: '/chat' };

test.describe('recovery prompt', () => {
  test('nothing to recover: no prompt', async ({ page }) => {
    const problems = await watchProblems(page);
    await preferences(page, { locale: 'en', theme: 'light' });
    await fakeChat(page, { latencyMs: 50, recovery: 'none' });
    await open(page, CHAT);
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`restored from a backup (${theme})`, async ({ page }) => {
      const problems = await watchProblems(page);
      await preferences(page, { locale: 'en', theme });
      await fakeChat(page, { latencyMs: 50, recovery: 'restored' });
      await open(page, CHAT);

      const dialog = page.getByRole('dialog', { name: 'Taalcut is back' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Your library file was damaged, so Taalcut put back the copy from');
      await expect(dialog.getByRole('button', { name: /Resume/ })).toHaveCount(0);

      await dialog.getByRole('button', { name: 'View details' }).click();
      await expect(dialog).toContainText('library.db.1760169600000.v5.daily.bak');
      await expect(dialog).toContainText('Your last saved changes');
      await screenshotWhole(page, `screenshots/${theme}/recovery-restored.png`);

      await dialog.getByRole('button', { name: 'Got it' }).click();
      await expect(dialog).toBeHidden();
      expect(problems).toEqual([]);
    });
  }

  test('unfinished run: resume picks it up and opens its chat', async ({ page }) => {
    const problems = await watchProblems(page);
    await preferences(page, { locale: 'en', theme: 'light' });
    await fakeChat(page, { latencyMs: 50, recovery: 'unfinished' });
    await open(page, { name: 'library', path: '/library' });

    const dialog = page.getByRole('dialog', { name: 'Taalcut is back' });
    await expect(dialog).toContainText('One agent task stopped partway.');
    await expect(dialog).toContainText('Everything you saved is still here.');
    await dialog.getByRole('button', { name: 'Resume the task' }).click();

    await expect(dialog).toBeHidden();
    // Success is silent: the chat opens, no toast says so.
    await expect(page).toHaveURL(/\/chat\/01K7C5M6Q8R9S0T1V2W3X4Y5Z6$/);
    await expect(page.getByText('Picking up where it left off', { exact: true })).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('mid-session: an agent restart offers its cut-off run, and Resume opens it', async ({ page }) => {
    const problems = await watchProblems(page);
    await preferences(page, { locale: 'en', theme: 'light' });
    await fakeChat(page, { latencyMs: 50, recovery: 'none' });
    await open(page, { name: 'library', path: '/library' });
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The page may still be subscribing: offer again until it hears (the run is the same each time).
    const dialog = page.getByRole('dialog', { name: 'The agent restarted' });
    await expect(async () => {
      await backend.agentRestarted(page);
      await expect(dialog).toBeVisible({ timeout: 500 });
    }).toPass();
    await expect(dialog).toContainText('It stopped unexpectedly and has started again.');
    await expect(dialog).toContainText('One agent task stopped partway.');
    await dialog.getByRole('button', { name: 'Resume the task' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/chat\/01K7C5M6Q8R9S0T1V2W3X4Y5Z6$/);
    expect(problems).toEqual([]);
  });

  test('mid-session: a re-offer joins the prompt already open, never a second dialog', async ({ page }) => {
    const problems = await watchProblems(page);
    await preferences(page, { locale: 'en', theme: 'light' });
    await fakeChat(page, { latencyMs: 50, recovery: 'everything' });
    await open(page, CHAT);
    const launch = page.getByRole('dialog', { name: 'Taalcut is back' });
    await expect(launch).toContainText('One agent task stopped partway.');

    await expect(async () => {
      await backend.agentRestarted(page);
      await expect(launch).toContainText('2 agent tasks stopped partway.', { timeout: 500 });
    }).toPass();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    // The launch report's restore is still there, with both runs.
    await expect(launch).toContainText('Your library file was damaged');
    await expect(launch.getByRole('button', { name: 'Resume the tasks' })).toBeVisible();

    // Not now, then another restart: a fresh prompt, without the launch report's restore.
    await launch.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await backend.agentRestarted(page);
    const again = page.getByRole('dialog', { name: 'The agent restarted' });
    await expect(again).toContainText('2 agent tasks stopped partway.');
    await expect(again).not.toContainText('Your library file was damaged');
    await again.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  for (const scenario of ['everything', 'missing'] as const) {
    test(`pseudo-locale (${scenario}): everything translated, nothing clipped`, async ({ page }) => {
      await preferences(page, { locale: 'en-XA', theme: 'light' });
      await fakeChat(page, { latencyMs: 50, recovery: scenario });
      await page.setViewportSize({ width: 1024, height: 720 });
      await open(page, CHAT);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.locator('[data-slot=dialog-footer] button').first().click();
      await expect(dialog.locator('[data-slot=recovery-details]')).toBeVisible();

      expect(untranslated(await userFacingText(page)), 'strings that skipped the catalogue').toEqual([]);
      expect(await clippedText(page), 'text that does not fit').toEqual([]);
      await screenshotWhole(page, `screenshots/pseudo/recovery-${scenario}.png`);
    });
  }
});
