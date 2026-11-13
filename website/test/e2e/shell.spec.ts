// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test, type Page } from '@playwright/test';

/** The WEB2 shell: a solid, sticky nav that deepens past the hero, its phone sheet, and the footer band. */
const header = (page: Page) => page.locator('header[data-slot="site-header"]');

test('the nav sticks, solid, and deepens once the page scrolls past its top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/features/');
  await expect(header(page)).not.toHaveAttribute('data-tinted', /.*/);
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['Features', 'Your AI', 'Platforms']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Features', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: /Join the waitlist/ })).toBeVisible();
  await page.mouse.wheel(0, 1200);
  await expect(header(page)).toHaveAttribute('data-tinted', 'true');
  const box = await header(page).boundingBox();
  expect(box?.y).toBe(0);
  const background = await header(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(await header(page).evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none');
});

test('on a phone the menu opens a sheet, focuses its first link, and Escape hands focus back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Open menu' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  const sheet = page.locator('#site-menu');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('link').first()).toBeFocused();
  await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  // Its targets are at least 24 px (WCAG 2.5.8).
  const size = await toggle.boundingBox();
  expect(Math.min(size?.width ?? 0, size?.height ?? 0)).toBeGreaterThanOrEqual(24);
});

test('the footer names the platforms, Instagram and GitHub, its links, and the licence, with Kaatu as decoration', async ({ page }) => {
  await page.goto('/about/');
  const footer = page.locator('footer[data-slot="site-footer"]');
  const platforms = footer.getByRole('list', { name: 'Platforms' });
  for (const words of ['macOS, Apple silicon', 'Ubuntu 24.04', 'Windows, after 1.0']) await expect(platforms).toContainText(words);
  for (const id of ['apple', 'ubuntu', 'windows', 'instagram', 'github']) await expect(footer.locator(`[data-slot="brand-icon"][data-brand="${id}"]`)).toBeVisible();
  await expect(footer.getByRole('link', { name: /Instagram/ })).toHaveAttribute('href', /instagram\.com/);
  await expect(footer).toContainText('GitHub, opens with the beta');
  const links = footer.getByRole('navigation', { name: 'Footer' });
  for (const name of ['Features', 'Your AI', 'Platforms', 'FAQ', 'About', 'Press', 'Contact', 'Waitlist', 'Privacy', 'Terms', 'Beta terms']) {
    await expect(links.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(footer).toContainText('Taalcut is free. Its code is under the AGPL-3.0-or-later licence and opens with the beta.');
  await expect(footer).not.toContainText(/draft/i);
  const kaatu = footer.locator('[data-slot="kaatu"]');
  await expect(kaatu).toHaveAttribute('aria-hidden', 'true');
  await expect(kaatu).toHaveAttribute('data-pose', 'big-wave');
});

test('the footer credits the company: its mark and words link to its site, beside the © line', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/');
  const footer = page.locator('footer[data-slot="site-footer"]');
  await expect(footer).toContainText('© 2026 Matterward Labs Private Limited');
  await expect(footer).not.toContainText('Taalcut contributors');
  const credit = footer.getByRole('link', { name: 'Made by Matterward Labs, the company that makes Taalcut' });
  await expect(credit).toHaveAttribute('href', 'https://matterwardlabs.com');
  await expect(credit).not.toHaveAttribute('target', /.*/);
  await expect(credit).toContainText('Made by Matterward Labs');
  const mark = credit.locator('[data-slot="brand-icon"][data-brand="matterward"]');
  await expect(mark).toHaveAttribute('aria-hidden', 'true');
  const size = await mark.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(16);
  expect(size?.width).toBeLessThanOrEqual(20);
  // A target of at least 24 px (WCAG 2.5.8), with the base focus ring.
  const box = await credit.boundingBox();
  expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(24);
  await credit.focus();
  expect(await credit.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  // Quieter than Taalcut's own lockup.
  const logo = await footer.getByRole('img', { name: 'Taalcut', exact: true }).first().boundingBox();
  expect(size?.height ?? 0).toBeLessThan(logo?.height ?? 0);
});
