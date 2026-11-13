// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Page } from '@playwright/test';
import { PAGES } from '../../src/content/pages';

/** Every listed page's path. */
export const PATHS = PAGES.map((p) => p.path);

/** Opens a page in a theme (the site's stored choice) and waits for fonts. */
export async function openInTheme(page: Page, path: string, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('taalcut.theme', t);
    } catch {
      // A blocked storage just means the default theme.
    }
  }, theme);
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}
