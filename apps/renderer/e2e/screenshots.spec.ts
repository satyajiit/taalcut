// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P1-H1 "Done when": every route is screenshot in light and dark. Files land
// in e2e-artifacts/screenshots/<theme>/<route>.png (git-ignored), the window
// bar alone in screenshots/<theme>/bar/<route>.png; CI uploads them as build
// artefacts.
import { expect, test } from '@playwright/test';
import { ROUTES } from './routes.ts';
import {
  ARTIFACTS,
  CANVAS,
  closeTo,
  hexToRgb,
  open,
  pixelOnScreen,
  preferences,
  screenshotWhole,
} from './support.ts';

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    // The OS says the opposite, so the screenshot proves the stored choice wins.
    test.use({ colorScheme: theme === 'dark' ? 'light' : 'dark' });

    for (const route of ROUTES) {
      test(`${route.name}`, async ({ page }) => {
        await preferences(page, { theme, locale: 'en' });
        await open(page, route);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        // The sidebar or page edge shows a canvas-family surface of the right theme.
        const corner = await pixelOnScreen(
          page,
          page.viewportSize()!.width - 2,
          page.viewportSize()!.height - 2,
        );
        expect(closeTo(corner, hexToRgb(CANVAS[theme]), 12), `bottom-right pixel ${corner} is ${theme}`).toBe(
          true,
        );
        await screenshotWhole(page, `screenshots/${theme}/${route.name}.png`);
        // Our window bar, on every route: 52 px, the controls (inert here: no window behind the
        // page), and the page's name in it.
        const bar = page.locator('[data-slot=window-bar]').first();
        expect((await bar.boundingBox())?.height).toBe(52);
        await expect(bar.getByRole('group', { name: 'Window controls' })).toBeVisible();
        await expect(bar.locator('[data-slot=window-title]')).not.toBeEmpty();
        await bar.screenshot({
          path: new URL(`screenshots/${theme}/bar/${route.name}.png`, ARTIFACTS).pathname,
        });
      });
    }
  });
}
