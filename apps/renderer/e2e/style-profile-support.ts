// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The style profile e2e's screenshots (LRN1-STY): where they go, and each one at both window sizes. */
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { ARTIFACTS } from './support.ts';

/** `TAALCUT_STY_SCREENS` names the folder (a lane's screens); else the run's artifacts. */
export const STY_SCREENS =
  process.env.TAALCUT_STY_SCREENS ?? new URL('screenshots/style-profile/', ARTIFACTS).pathname;

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1024, height: 720 },
] as const;

/** The window with `target` in view, at 1280×800 and 1024×720, as `<name>-<width>x<height>.png`. */
export async function shootStyle(page: Page, name: string, target: Locator): Promise<void> {
  mkdirSync(STY_SCREENS, { recursive: true });
  const size = page.viewportSize();
  for (const { width, height } of SIZES) {
    await page.setViewportSize({ width, height });
    await target.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${STY_SCREENS}${name}-${width}x${height}.png`, animations: 'disabled' });
  }
  if (size) await page.setViewportSize(size);
}
