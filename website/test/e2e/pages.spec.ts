// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test } from '@playwright/test';
import { PAGES } from '../../src/content/pages';

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  for (const entry of PAGES) {
    test(`${entry.path} has its words, canonical and structured data`, async ({ page }) => {
      const response = await page.goto(entry.path);
      expect(response?.status()).toBe(200);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new URL(entry.path, 'https://taalcut.app').toString());
      await expect(page).toHaveTitle(/Taalcut/);
      for (const script of await page.locator('script[type="application/ld+json"]').allTextContents()) {
        expect(() => JSON.parse(script)).not.toThrow();
      }
    });
  }
});

test('an unknown address answers 404 with a way home', async ({ page }) => {
  const response = await page.goto('/no-such-page/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('link', { name: 'Go to the home page' })).toBeVisible();
});
