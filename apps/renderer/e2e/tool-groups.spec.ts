// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Consecutive calls still retain their order and failures, but one run-level activity disclosure owns them.
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { TOOLS_CHAT } from './routes.ts';
import { fakeChat, open, preferences, watchProblems } from './support.ts';

const TOOLS = { name: 'chat-tools', path: `/chat/${TOOLS_CHAT}` };
const ASK = 'Which of my newest clips are from the beach?';
const toggle = (page: Page) => page.locator('[data-slot=run-activity-toggle]');
const region = (page: Page) => page.locator('[data-slot=run-activity]');
const failed = (page: Page) => page.locator('[data-slot=tool-run][data-status=failed]');

async function ask(page: Page) {
  await open(page, { name: 'chat', path: '/chat' });
  const box = page.getByRole('textbox', { name: 'Message Taalcut' });
  await box.fill(ASK);
  await box.press('Enter');
}

for (const theme of ['light', 'dark'] as const) {
  test(`history keeps failures visible and reveals compact operations with the keyboard (${theme})`, async ({
    page,
  }, info) => {
    const problems = await watchProblems(page);
    await fakeChat(page, { latencyMs: 50 });
    await preferences(page, { locale: 'en', theme });
    await open(page, TOOLS);
    await expect(toggle(page)).toHaveCount(1);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(region(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(region(page)).toHaveAttribute('inert', '');
    await expect(failed(page)).toHaveCount(1);
    await expect(failed(page)).toContainText('This took too long and was stopped.');
    await expect(failed(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(await failed(page).evaluate((row) => row.closest('[data-slot=run-activity]') === null)).toBe(true);
    await expect(page.locator('[data-slot=run-announcement]')).toHaveText('');
    await toggle(page).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(toggle(page)).not.toBeFocused();
    await page.keyboard.press('Tab');
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(region(page).locator('[data-slot=tool-run]')).toHaveCount(0);
    await expect(region(page).locator('[data-slot=tool-group]')).toHaveCount(2);
    await expect(region(page).locator('[data-tool="library.getAsset"]')).toHaveAttribute('data-count', '10');
    await expect(region(page).locator('[data-tool="vision.describeFrame"]')).toHaveAttribute(
      'data-count',
      '3',
    );
    await expect(region(page).locator('[data-slot=tool-summary]')).toHaveCount(13);
    await expect(region(page)).toContainText('IMG_0430.MOV · 0:27');
    await expect(region(page).locator('details, button[aria-expanded]')).toHaveCount(0);
    await expectAccessible(page, info, `flat tool activity ${theme}`);
    await page.keyboard.press('Space');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    expect(problems).toEqual([]);
  });
}

test('concurrent live calls use one quiet summary while work is still running', async ({ page }, info) => {
  await fakeChat(page, { latencyMs: 50, holdAfter: 'agent.toolFinished' });
  await preferences(page, { locale: 'en', theme: 'light' });
  await ask(page);
  await expect(region(page).locator('[data-slot=tool-run]')).toHaveCount(0);
  await expect(region(page).locator('[data-slot=tool-group]')).toHaveCount(1);
  await expect(region(page).locator('[data-slot=tool-group]')).toHaveAttribute('data-count', '11');
  await expect(region(page).locator('[data-slot=tool-group]')).toHaveAttribute('data-status', 'running');
  await expect(toggle(page)).toHaveCount(1);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(page.locator('[data-slot=run-announcement]')).toHaveText('');
  await expectAccessible(page, info, 'activity while concurrent calls run');
});

test('completed live work and persisted history expose the same outcomes and recovery', async ({ page }) => {
  await fakeChat(page, { latencyMs: 50, speed: 2 });
  await preferences(page, { locale: 'en', theme: 'light' });
  await ask(page);
  await expect(page.getByText('so it isn’t counted.')).toBeVisible({ timeout: 20_000 });
  await expect(region(page).locator('[data-slot=tool-run]')).toHaveCount(0);
  await expect(region(page).locator('[data-slot=tool-group]')).toHaveCount(2);
  await expect(region(page).locator('[data-slot=tool-summary]')).toHaveCount(13);
  await expect(page.locator('[data-slot=run-announcement]')).not.toHaveText('');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(failed(page)).toBeVisible();
  const outcomes = () =>
    region(page)
      .locator('[data-slot=tool-group]')
      .evaluateAll((rows) =>
        rows.map((row) => ({
          tool: row.getAttribute('data-tool'),
          status: row.getAttribute('data-status'),
          count: row.getAttribute('data-count'),
          summaries: [...row.querySelectorAll('[data-slot=tool-summary]')].map((node) => node.textContent),
        })),
      );
  const recovery = () =>
    failed(page)
      .locator('[data-slot=error-line]')
      .evaluate((row) => ({
        code: row.getAttribute('data-error-code'),
        message: row.querySelector('p')?.textContent,
        actions: [...row.querySelectorAll('button')].map((button) => button.textContent),
      }));
  await expect(failed(page).getByText('Inspect a clip', { exact: true })).toBeVisible();
  const live = await outcomes();
  const liveRecovery = await recovery();
  await open(page, TOOLS);
  await expect(region(page).locator('[data-slot=tool-group]')).toHaveCount(2);
  expect(await outcomes()).toEqual(live);
  await expect(failed(page).getByText('Inspect a clip', { exact: true })).toBeVisible();
  expect(await recovery()).toEqual(liveRecovery);
  await expect(failed(page).getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-slot=run-announcement]')).toHaveText('');
});
