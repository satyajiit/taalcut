// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-R2 bespoke keyboard checks on every route (apps/renderer/SPEC.md, "P3-R2: accessibility pass targets"): Tab from
// the top of the page through its first forty stops; each one shows a ring (2.4.7) and is never entirely covered by
// the window bar, the dock or a toast (2.4.11), and Tab always moves on (2.1.2).
import { expect, test } from '@playwright/test';
import { FocusLog, walkTabs } from './keyboard.ts';
import { ROUTES } from './routes.ts';
import { open, preferences } from './support.ts';

test.use({ hasTouch: false });

for (const route of ROUTES) {
  test(`${route.name}: every Tab stop is shown and in view`, async ({ page }) => {
    await preferences(page, { theme: 'light', locale: 'en' });
    await open(page, route);
    const log = new FocusLog();
    const stops = await walkTabs(page, log, route.path);
    expect(stops, `${route.path}: Tab reaches something`).toBeGreaterThan(0);
    expect(log.problems, `focus stops:\n${log.stops.join('\n')}`).toEqual([]);
  });
}
