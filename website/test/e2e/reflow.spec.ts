// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { expect, test } from '@playwright/test';
import { PATHS } from './helpers';

/** No sideways scroll at phone and tablet widths (WCAG 1.4.10; Hallmark's 320/375/414/768). */
for (const width of [320, 375, 414, 768]) {
  test(`every page fits ${width} px without sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of PATHS) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
}
