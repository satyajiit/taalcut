// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, type Page } from '@playwright/test';

/** Reveals precise tracks after a task, without relying on translated button words. */
export async function showDetailedTimeline(page: Page) {
  const bed = page.locator('[data-slot=timeline-bed]');
  if (await bed.isVisible()) return;
  const toggle = page.locator('[data-slot=timeline-detail-toggle]');
  if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click();
  await toggle.click();
  await expect(bed).toBeVisible();
}

/** The toolbar owns project tasks; the persistent chat remains beside them. */
export async function openEditorTask(
  page: Page,
  task: 'look' | 'versions' | 'comments' | 'cleanup' | 'files',
) {
  await page.locator('[data-slot=editor-actions] button[aria-haspopup=menu]').last().click();
  await page
    .getByRole('menuitem')
    .nth(['look', 'versions', 'comments', 'cleanup', 'files'].indexOf(task))
    .click();
}
