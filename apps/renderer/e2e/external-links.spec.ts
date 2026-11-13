// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Round P3-3 (G8): web pages open in the browser through main. Each link asks `files.openExternal` with its page
// (the fake answers with nothing, as main does once the system has it) and never opens a window: Add credit,
// Manage usage, the beta terms and a provider's key page. The call is read off the fake's wire.
import { expect, test, type Page } from '@playwright/test';
import { preferences, watchProblems } from './support.ts';
import { fakes } from './ui2b-support.ts';
import { fakeCall, watchWire, wireCalls } from './wire-watch.ts';

const OPEN = '/files/openExternal';
const opened = (page: Page) =>
  wireCalls<{ url: string }>(page, OPEN).then((calls) => calls.map((call) => call.url));

/** Clicks the link: main is asked for exactly that page, and no window opens. */
async function opens(page: Page, name: RegExp, url: string) {
  const link = page.getByRole('link', { name });
  await expect(link).toHaveAttribute('href', url);
  const popups: string[] = [];
  page.on('popup', (popup) => popups.push(popup.url()));
  await link.click();
  await expect.poll(() => opened(page)).toEqual([url]);
  expect(popups).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await preferences(page, { theme: 'light', locale: 'en' });
  await watchWire(page, [OPEN]);
});

test('Settings › Usage: Add credit and Manage usage', async ({ page }) => {
  const problems = await watchProblems(page);
  await fakes(page, { onboarding: 'done', limits: 'three' });
  await page.goto('/settings/usage');
  await opens(page, /^Add credit/, 'https://platform.openai.com/settings/organization/billing');

  await fakeCall(page, 'accounts.signIn', ['openai-codex']);
  const manage = page.getByRole('list', { name: 'Plans you signed in with' }).getByRole('link');
  await expect(manage).toHaveAccessibleName(/^Manage usage/);
  await manage.click();
  await expect
    .poll(() => opened(page))
    .toEqual([
      'https://platform.openai.com/settings/organization/billing',
      'https://chatgpt.com/codex/settings/usage',
    ]);
  expect(problems).toEqual([]);
});

test('Settings › Usage: a subscription’s own usage page', async ({ page }) => {
  await fakes(page, { onboarding: 'done' });
  await page.goto('/settings/usage');
  await expect(page.locator('[data-slot=usage-totals]')).toBeVisible();
  await fakeCall(page, 'accounts.signIn', ['anthropic', Date.now()]);
  const plans = page.getByRole('list', { name: 'Plans you signed in with' });
  await expect(plans.getByText('Its usage is on Claude’s own site.')).toHaveCount(0);
  await opens(page, /^Usage on Claude’s site/, 'https://claude.ai/settings/usage');
});

test('first run: the beta terms and a provider’s key page', async ({ page }) => {
  const problems = await watchProblems(page);
  await fakes(page, { onboarding: 'fresh', channel: 'beta', library: 'empty' });
  await page.goto('/onboarding/beta');
  await opens(page, /^Read the beta terms/, 'https://taalcut.app/beta-terms/');

  // UX4: the ways to think open from the last step's Kaatu moment when nothing can think yet.
  await page.goto('/onboarding/first-video');
  await page.locator('[data-action="quiet-check-open"]').click();
  await page.locator('li[data-way="api-key"] > button').click();
  await opens(page, /^Get a key from OpenAI/, 'https://platform.openai.com/api-keys');
  expect(problems).toEqual([]);
});

test('the keyboard opens a page too', async ({ page }) => {
  await fakes(page, { onboarding: 'done', limits: 'three' });
  await page.goto('/settings/usage');
  const link = page.getByRole('link', { name: /^Add credit/ });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => opened(page))
    .toEqual(['https://platform.openai.com/settings/organization/billing']);
});
