// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The window bar in a plain browser (DESIGN.md, "Window"): the page's name is
// the bar's h1, the window going inactive and the sidebar button, and the
// controls' states from the kit (the live controls need Electron: see
// apps/desktop/e2e/window-bar.e2e.ts). Screenshots land in
// e2e-artifacts/screenshots/<theme>/window-*.png.
import { expect, test, type Page } from '@playwright/test';
import { ARTIFACTS, fakeChat, open, preferences, toRgb } from './support.ts';

const CHAT = { name: 'chat-conversation', path: '/chat/01K7C5M6Q8R9S0T1V2W3X4Y5Z6' };
const shot = (theme: string, name: string) =>
  new URL(`screenshots/${theme}/window-${name}.png`, ARTIFACTS).pathname;
const bar = (page: Page) => page.locator('[data-slot=window-bar]');

/** The colour a CSS custom property resolves to, as the page would paint it. */
async function token(page: Page, name: string) {
  const value = await page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n),
    name,
  );
  return toRgb(page, value.trim());
}

async function colourOf(page: Page, selector: string) {
  const value = await page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  return toRgb(page, value);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await preferences(page, { theme, locale: 'en' });
      await fakeChat(page, { latencyMs: 0 });
    });

    test('the page’s name is the bar’s h1, with what is open after it; never twice', async ({ page }) => {
      await open(page, { name: 'library', path: '/library' });
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(bar(page).getByRole('heading', { level: 1 })).toHaveText('Library');
      await expect(page).toHaveTitle('Library · Taalcut');

      await open(page, CHAT);
      const title = bar(page).getByRole('heading', { level: 1 });
      await expect(title).toHaveText(/^Agent.*Trip to Goa reel$/);
      await expect(page.locator('main h1')).toHaveCount(0);
      await bar(page).screenshot({ path: shot(theme, 'bar') });
    });

    test('goes quiet when the window is not the active one, and comes back', async ({ page }) => {
      await open(page, CHAT);
      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-window-active', 'true');
      const ink = await token(page, '--color-ink');
      expect(await colourOf(page, '[data-slot=window-title]')).toEqual(ink);

      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect(html).toHaveAttribute('data-window-active', 'false');
      expect(await colourOf(page, '[data-slot=window-title]')).toEqual(await token(page, '--color-ink-3'));
      await bar(page).screenshot({ path: shot(theme, 'bar-inactive') });
      await page.screenshot({ path: shot(theme, 'inactive') });

      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(html).toHaveAttribute('data-window-active', 'true');
    });

    test('the sidebar folds to its rail and opens with its button and ⌃⌘S; the bar’s band follows', async ({
      page,
    }) => {
      await open(page, { name: 'library', path: '/library' });
      const lead = page.locator('[data-slot=window-bar-lead]');
      const toggle = bar(page).getByRole('button', { name: 'Sidebar' });
      expect((await lead.boundingBox())?.width).toBe(240);
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle).toHaveAttribute('aria-controls', 'app-sidebar');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      // The rail keeps the areas, as icons.
      await expect(page.locator('[data-slot=sidebar][data-rail]')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Areas' })).toBeVisible();
      expect((await lead.boundingBox())?.width).toBeLessThan(140);
      await page.screenshot({ path: shot(theme, 'sidebar-rail') });
      // ⌘K has it too, with its shortcut (core's view.sidebar command); once it is listed, ⌃⌘S works.
      await page.keyboard.press('ControlOrMeta+k');
      await page.keyboard.type('sidebar');
      await expect(page.getByRole('option', { name: /Expand sidebar/ })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Commands' })).toHaveCount(0);
      await page.keyboard.press('Control+Meta+KeyS');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('[data-slot=sidebar]:not([data-collapsed])')).toBeVisible();
      await expect.poll(async () => (await lead.boundingBox())?.width).toBe(240);
    });

    test('the controls in every state (the kit’s previews), and live ones pointed at', async ({ page }) => {
      await open(page, { name: 'dev-kit', path: '/dev/kit' });
      const section = page.locator('section', {
        has: page.getByRole('heading', { name: 'Window', exact: true }),
      });
      await section.scrollIntoViewIfNeeded();
      const states = ['Default', 'Hover', 'Pressed', 'Inactive', 'Disabled', 'Focus (assistive tech)'];
      for (const state of states)
        await expect(section.getByRole('group', { name: state, exact: true })).toBeVisible();
      await section.screenshot({ path: shot(theme, 'states') });

      const live = section.locator('[data-slot=window-controls-preview] [data-slot=window-controls]');
      await live.hover();
      // Pointing at one shows the glyphs on all three.
      for (const glyph of await live.locator('svg').all()) await expect(glyph).toHaveCSS('opacity', '1');
      await live.screenshot({ path: shot(theme, 'controls-hover') });
    });
  });
}
