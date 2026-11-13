// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// BRK1-REV: what the review's e2e specs share: where screenshots go, the seeded chats and how the sheet is opened.
import { expect, type Page } from '@playwright/test';
import { backend } from './backend-driver.ts';
import { ARTIFACTS } from './support.ts';

const SCREENS = process.env.TAALCUT_REVIEW_SCREENS ?? new URL('screenshots/review/', ARTIFACTS).pathname;
export const shot = (name: string) => new URL(`${name}.png`, `file://${SCREENS.replace(/\/?$/, '/')}`).href;

export const PORTRAIT = { name: 'chat', path: '/chat/01K7C5M6Q8R9S0T1V2W3X4RV01' };
export const LANDSCAPE = { name: 'chat', path: '/chat/01K7C5M6Q8R9S0T1V2W3X4RV02' };
export const card = (page: Page) => page.locator('[data-card-type=breakdown]');
export const sheet = (page: Page) => page.locator('[data-slot=review-sheet]');
export const count = (page: Page) => page.locator('[data-slot=review-count]');
export const heading = (page: Page) => page.locator('[data-slot=review-panel] h3[data-landing=slot]');
export const ran = async (page: Page, prefix = 'template.') =>
  (await backend.dispatched(page)).filter((d) => d.name.startsWith(prefix)).map((d) => d.name);

export async function openSheet(page: Page) {
  await expect(card(page).locator('[data-slot=breakdown-summary]')).toBeVisible({ timeout: 15_000 });
  await card(page).getByRole('button', { name: 'Review the reel' }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(heading(page)).toBeVisible();
}
