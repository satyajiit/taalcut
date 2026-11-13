// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, type Page } from '@playwright/test';

/** Project tasks replace the tracks; chat stays visible. */
export async function openComments(page: Page) {
  await page.locator('[data-slot=editor-actions]').getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Comments', exact: true }).click();
}

export async function showDetailedTimeline(page: Page) {
  if (await page.locator('[data-slot=timeline-bed]').isVisible()) return;
  const toggle = page.locator('[data-slot=timeline-detail-toggle]');
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click();
  await toggle.click();
  await expect(page.locator('[data-slot=timeline-bed]')).toBeVisible();
}
