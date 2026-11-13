// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P2-X2 "Done when" (the window's part): the panel says what leaves this Mac per job, from the same
// request log Usage lists; Local only turns reference links off and keeps the file way in; the switches
// are the person's (a failed write goes back and says why). P2-X1: budgets in Usage.
// UX4: Privacy is two views, What leaves (Local only, each job, the uploads you always allow) and Sharing (Help
// improve Taalcut, everything else that uses the internet); Usage's budgets are its Budgets view.
import { expect, test, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { open, preferences } from './support.ts';
import { expectAccessible, expectPseudoClean, fakes, shoot } from './ui2b-support.ts';

const PRIVACY = { name: 'settings-privacy', path: '/settings/privacy' };
const SHARING = { name: 'settings-privacy-sharing', path: '/settings/privacy/sharing' };
const BUDGETS = { name: 'settings-usage-budgets', path: '/settings/usage/budgets' };

/** One of Privacy's views, by its link in the views row: moving in the page keeps the fakes' state. */
const view = (page: Page, name: string) =>
  page.locator('[data-slot=settings-views]').getByRole('link', { name, exact: true });

for (const theme of ['light', 'dark'] as const) {
  test(`Privacy and Usage in ${theme}: accessible, as designed`, async ({ page }, testInfo) => {
    await preferences(page, { theme, locale: 'en' });
    await open(page, PRIVACY);
    await expect(page.locator('[data-module]').first()).toBeVisible();
    await expectAccessible(page, testInfo, `privacy (${theme})`);
    await shoot(page, `privacy-${theme}`);
    await open(page, SHARING);
    await expect(page.locator('[data-flow]').first()).toBeVisible();
    await expectAccessible(page, testInfo, `privacy sharing (${theme})`);
    await shoot(page, `privacy-sharing-${theme}`);
    await open(page, BUDGETS);
    await expect(page.getByRole('list', { name: 'Project budgets' })).toBeVisible();
    await expectAccessible(page, testInfo, `usage (${theme})`);
    await shoot(page, `usage-${theme}`);
  });
}

test('each job says what it sends, and See in Usage shows its requests', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, PRIVACY);
  const agent = page.locator('li[data-module=agent]');
  await expect(agent).toContainText('Sends messages, tool results, prompts, your memory to');
  await expect(agent.locator('[data-slot=last-30-days]')).toContainText('requests to the cloud');
  // A job that only runs here sends nothing.
  await expect(page.locator('li[data-module=embeddings]')).toContainText('Nothing leaves');
  // See in Usage opens the request log, filtered to that job.
  await agent.getByRole('link', { name: 'See in Usage: Agent' }).click();
  await expect(page).toHaveURL(/\/settings\/usage\/requests\?module=agent$/);
  await expect(
    page.locator('[data-slot=usage-filters]').getByRole('button', { name: 'Agent' }),
  ).toHaveAttribute('data-set', 'true');
  // Update checks are on Sharing, and name the staging id electron-updater sends (security review SB-21).
  await open(page, SHARING);
  const updates = page.locator('li[data-flow=update-checks]');
  await expect(updates).toContainText('Each check also sends a random ID made for this Mac');
  await expect(updates).toContainText('It isn’t linked to you or your files, and Taalcut doesn’t log it.');
  // Help improve's two switches stand above the other flows and aren't listed again under them.
  await expect(page.locator('li[data-flow=telemetry], li[data-flow=crash-reports]')).toHaveCount(0);
});

test('Local only: cloud jobs and reel links go off, the file way in stays', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, PRIVACY);
  const localOnly = page.getByRole('switch', { name: 'Local only' });
  await localOnly.click();
  await expect(localOnly).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Local only is on' })).toBeVisible();
  await expect(page.locator('li[data-module=images]')).toContainText('Off while Local only is on');
  // A person-only command with no inverse: run as the person, and not on ⌘Z's list.
  expect((await backend.dispatched(page)).at(-1)).toEqual({ name: 'privacy.setLocalOnly', source: 'ui' });
  // Sharing, moved to in the page (a reload would start the fake afresh): usage counts paused, reel links off.
  await view(page, 'Sharing').click();
  await expect(page).toHaveURL(/\/settings\/privacy\/sharing$/);
  await expect(page.getByRole('switch', { name: 'Share usage counts' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.locator('li[data-flow=reference-links]')).toContainText('Off while Local only is on');

  // In the page (a reload would start the fake afresh): the new-chat surface reads Local only too.
  // Settings is its own route, without the app's sidebar: back to the app first.
  await page.getByRole('navigation', { name: 'App' }).getByRole('link', { name: 'Back to app' }).click();
  await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Agent' }).click();
  await page.getByRole('button', { name: /Paste a reel/ }).click();
  await expect(page.getByLabel('Link to a reel')).toBeDisabled();
  await expect(page.getByText('Paste a reel needs the internet. Drop a file instead.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose a file…' })).toBeEnabled();
});

test('a switch whose write fails goes back and says why', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, SHARING);
  await page.evaluate(() =>
    (
      window as unknown as { taalcutFake: { privacy: { failNext(name: string): void } } }
    ).taalcutFake.privacy.failNext('privacy.setCrashReports'),
  );
  const crash = page.getByRole('switch', { name: 'Send crash reports' });
  await crash.click();
  await expect(page.locator('[data-setting=crash-reports] [role=alert]')).toBeVisible();
  await expect(crash).toHaveAttribute('aria-checked', 'false');
  await expect(crash).toHaveAttribute('aria-invalid', 'true');
  // Trying again works.
  await crash.click();
  await expect(crash).toHaveAttribute('aria-checked', 'true');
});

test('usage counts take the alpha code, checked before it is sent', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, SHARING);
  await page.getByRole('switch', { name: 'Share usage counts' }).click();
  const code = page.getByLabel('Alpha code (optional)');
  await code.fill('k7q');
  await page.getByRole('button', { name: 'Save code' }).click();
  await expect(page.getByRole('alert')).toHaveText('The code is six letters and numbers, like K7Q2MX.');
  await code.fill('k7q2mx');
  await expect(code).toHaveValue('K7Q2MX');
  await page.getByRole('button', { name: 'Save code' }).click();
  await expect(
    page.getByText('Saved. Your events are grouped with the other testers who have it.'),
  ).toBeVisible();
});

test('budgets in Usage: a project’s cap changes, and Undo puts it back', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, BUDGETS);
  const goa = page.locator('li[data-project]').filter({ hasText: 'Golden hour market' });
  await goa.getByRole('button', { name: 'Change' }).click();
  await goa.getByLabel('Budget for this project').fill('5');
  await goa.getByRole('button', { name: 'Save' }).click();
  await expect(goa.getByRole('meter', { name: 'Project budget' })).toHaveAttribute(
    'aria-valuetext',
    '$1.92 of $5.00 spent',
  );
  expect((await backend.dispatched(page)).at(-1)).toEqual({ name: 'project.setBudgetCap', source: 'ui' });
  // The project's history, not the app's: the toast's Undo reaches it.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(goa.getByRole('meter', { name: 'Project budget' })).toHaveAttribute(
    'aria-valuetext',
    '$1.92 of $2.00 spent',
  );
});

test('budgets in Usage: the default cap is the person’s, and ⌘Z puts it back', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await open(page, BUDGETS);
  const field = page.getByLabel('Budget for each new project');
  await field.fill('3.50');
  await page.locator('[data-setting=default-cap]').getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(async () => (await backend.dispatched(page)).at(-1))
    .toEqual({
      name: 'budget.setDefaultCap',
      source: 'ui',
    });
  await expect(field).toHaveValue('3.50');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+z');
    await expect(field).toHaveValue('2.00', { timeout: 500 });
  }).toPass();
});

test('Privacy and Usage in the pseudo-locale: everything translated, nothing clipped', async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en-XA' });
  await fakes(page, { telemetry: true });
  await page.setViewportSize({ width: 1024, height: 720 });
  await open(page, PRIVACY);
  await expectPseudoClean(page, 'privacy');
  await open(page, SHARING);
  await expectPseudoClean(page, 'privacy sharing');
  await open(page, BUDGETS);
  await expectPseudoClean(page, 'usage budgets');
});
