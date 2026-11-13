// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PATHS, openInTheme } from './helpers';

/** WCAG 2.2 AA on every page in both themes, with motion settled (reduced motion: nothing mid-flight). */
test.use({ reducedMotion: 'reduce' });

for (const theme of ['light', 'dark'] as const) {
  for (const path of PATHS) {
    test(`${path} in ${theme} passes axe (WCAG 2.2 AA)`, async ({ page }) => {
      await openInTheme(page, path, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
}
