// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1 W2-1 (H4): a page that fails takes only the page's place. The window bar, the sidebar and ⌘K stay; the
// message names the cause and offers Reload and Back (shell-states/page-error.tsx, the router's
// defaultErrorComponent). A command that fails says so in a toast with its fix (backend/use-command.ts).
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { FAKE_OPTIONS_KEY, open, preferences, watchProblems } from './support.ts';

/** From now on every script the page asks for throws as it loads: the next page's code is broken. */
async function breakCode(page: Page, body: string): Promise<void> {
  await page.route('**/assets/*.js', (route) => route.fulfill({ contentType: 'text/javascript', body }));
}

async function goInside(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    window.history.pushState(window.history.state, '', to);
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }, path);
}

const BUG = "throw new TypeError('Cannot read properties of undefined (reading \\'items\\')');";
const TIMEOUT = "throw { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true };";

/** The page's error is logged for developers: that line, and nothing else, is expected on the console. */
const unexpected = (problems: string[]) =>
  problems.filter((line) => !/reading 'items'|core\.timeout|\[object Object\]/.test(line));

test.describe('a page that fails', () => {
  test('keeps the window bar, the sidebar and ⌘K, names the cause, and goes back', async ({ page }) => {
    const problems = await watchProblems(page);
    await preferences(page, { locale: 'en', theme: 'light' });
    await open(page, { name: 'library', path: '/library' });
    await breakCode(page, BUG);
    // A link, so the app's history has somewhere to go back to.
    await page.getByRole('navigation', { name: 'Areas' }).getByRole('link', { name: 'Templates' }).click();

    const error = page.locator('[data-slot=page-error]');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('data-cause', 'bug');
    await expect(page.getByRole('heading', { level: 1, name: 'This page hit a bug' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Your work is saved.');
    // Only the page failed: the window bar (named for where you are), the sidebar and ⌘K are all still there.
    await expect(page.locator('[data-slot=window-bar] [data-slot=window-title]')).toHaveText('Templates');
    await expect(page.locator('[data-slot=sidebar]')).toBeVisible();
    await page.keyboard.press('Meta+k');
    await expect(page.locator('[data-slot=command-palette]')).toBeVisible();
    await page.keyboard.press('Escape');

    for (const name of ['Reload the page', 'Go back', 'Report this'])
      await expect(page.getByRole('button', { name })).toBeVisible();
    await page.unroute('**/assets/*.js');
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator('[data-slot=library]')).toBeVisible();
    expect(unexpected(problems)).toEqual([]);
  });

  test('a known error says its own cause; Report this opens Send feedback', async ({ page }) => {
    const problems = await watchProblems(page);
    await preferences(page, { locale: 'en', theme: 'light' });
    await open(page, { name: 'library', path: '/library' });
    await breakCode(page, TIMEOUT);
    await goInside(page, '/projects');
    await expect(page.locator('[data-slot=page-error]')).toHaveAttribute('data-cause', 'known');
    await expect(page.getByRole('heading', { level: 1, name: 'This page didn’t load' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('This took too long and was stopped. Try again.');
    // Not a bug: nothing to report from here.
    await expect(page.getByRole('button', { name: 'Report this' })).toHaveCount(0);
    await page.unroute('**/assets/*.js');

    await breakCode(page, BUG);
    await goInside(page, '/renders');
    await page.getByRole('button', { name: 'Report this' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(unexpected(problems)).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`is accessible in ${theme}`, async ({ page }, testInfo) => {
      await preferences(page, { locale: 'en', theme });
      await open(page, { name: 'library', path: '/library' });
      await breakCode(page, BUG);
      await goInside(page, '/settings/privacy');
      await expect(page.locator('[data-slot=page-error]')).toBeVisible();
      await expectAccessible(page, testInfo, `page error, ${theme}`);
    });
  }
});

test.describe('a command that fails', () => {
  test('says why inline, instead of failing silently', async ({ page }) => {
    const problems = await watchProblems(page);
    await preferences(page, { locale: 'en', theme: 'light' });
    // The fake's folder picker answers with an empty path, which the command refuses: Add folder fails.
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
      key: FAKE_OPTIONS_KEY,
      value: JSON.stringify({ pickedFolder: '' }),
    });
    await open(page, { name: 'library-import-folder', path: '/library/import/folder' });
    await page.locator('[data-action=import-connect]').click();
    const toast = page.getByRole('alert');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Taalcut got something it could not read.');
    expect(problems).toEqual([]);
  });
});

test.describe('a page that isn’t there', () => {
  test('a bad id goes back to its own area; an unknown address goes to the chat', async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, { name: 'not-found-bad-id', path: '/library/not-an-id' });
    await expect(page.getByRole('link', { name: 'Back to Library' })).toHaveAttribute('href', '/library');
    await open(page, { name: 'not-found', path: '/no-such-page' });
    await expect(page.getByRole('link', { name: 'Go to chat' })).toHaveAttribute('href', '/chat');
  });
});
