// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P1-H1 "Done when": no CSP violations on any route. `vite preview` sends the
// desktop app's CSP (csp.ts), so anything Electron would block fails here too.
import { expect, test } from '@playwright/test';
import { CONTENT_SECURITY_POLICY } from '../csp.ts';
import { ROUTES } from './routes.ts';
import { open, preferences, watchProblems } from './support.ts';

test('the preview server sends the desktop CSP', async ({ page }) => {
  const response = await page.goto('/chat');
  expect(response?.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
});

test.describe('no CSP violations or console errors', () => {
  for (const route of ROUTES) {
    test(route.name, async ({ page }) => {
      const problems = await watchProblems(page);
      await preferences(page, { locale: 'en' });
      await open(page, route);
      expect(problems).toEqual([]);
    });
  }

  test('dialogs, menus and tooltips (scroll lock uses a constructed stylesheet)', async ({ page }) => {
    const problems = await watchProblems(page);
    await open(page, { name: 'dev-kit', path: '/dev/kit' });

    await page.locator('[data-slot=card]').getByRole('button', { name: 'Delete project' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this project?' });
    await expect(dialog).toBeVisible();
    // react-remove-scroll locked the page through the CSP-safe stylesheet.
    await expect(page.locator('body')).toHaveAttribute('data-scroll-locked', /\d/);
    expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBeGreaterThan(0);
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.adoptedStyleSheets.length)).toBe(0);

    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Undo', exact: true }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Undo');
    expect(problems).toEqual([]);
  });
});
