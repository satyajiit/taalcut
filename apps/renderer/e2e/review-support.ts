// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, type Page } from '@playwright/test';

/** A chat's page, with its id: where the review page's answers come back to. */
export const CHAT_URL = /\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * UX4 (B8): the chat's export card is a summary; the approval is made on its review page. Opens the page from the
 * card's "Review and export" and waits for the video's page.
 */
export async function openReview(page: Page) {
  await page
    .locator('[data-card-type=exportApproval]')
    .last()
    .getByRole('button', { name: 'Review and export' })
    .click();
  await expect(page.locator('[data-slot=review-page]')).toBeVisible();
  await expect(page).toHaveURL(/\/chat\/[0-9A-HJKMNP-TV-Z]{26}\/review\/[^/]+$/);
}

/** Opens the review page, answers Export or Not now there, and is back in the chat it came from. */
export async function reviewAndAnswer(page: Page, answer: 'Export' | 'Not now') {
  await openReview(page);
  await page.locator('[data-slot=review-bar]').getByRole('button', { name: answer, exact: true }).click();
  await expect(page).toHaveURL(CHAT_URL);
}
