// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX4's review page (B8): the run's one export approval is a page of its own under the chat
 * (apps/renderer/src/chat/review-page.tsx, the kit's ExportReview). The chat's "Ready to export" card is a summary
 * whose one button, "Review and export", opens it; the page has its own Export, Not now, and Options, where the
 * quick swaps and the other choices live. Every way out (Export or Not now once the run has taken the answer, and
 * Escape) goes back to the chat, where the card says how it settled. The renderer's specs drive the same page on
 * the fakes (apps/renderer/e2e/review-support.ts); these are the make flow's, in the real app.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** A chat's page: where the review page goes back to. */
const CHAT_URL = /\/chat\/[0-9A-HJKMNP-TV-Z]{26}$/;

export const reviewPage = (page: Page) => page.locator('[data-slot=review-page]');
const reviewButton = (card: Locator) => card.getByRole('button', { name: 'Review and export' });

/**
 * The approval asks: the card waits on you and its button leads to the review page. A card folding in a swap
 * ("updating") keeps the button, so the status is what says the run asks again.
 */
export async function approvalAsks(card: Locator, timeout: number): Promise<void> {
  await expect(card.locator('[data-card-type=exportApproval]')).toHaveAttribute('data-status', 'pending', {
    timeout,
  });
  await expect(reviewButton(card)).toBeEnabled();
}

/** Opens the card's review page. */
export async function openReview(page: Page, card: Locator): Promise<Locator> {
  await reviewButton(card).click();
  const review = reviewPage(page);
  await expect(review).toBeVisible();
  return review;
}

/** Back in the chat the review page was opened from. */
export async function backInChat(page: Page, timeout?: number): Promise<void> {
  await expect(reviewPage(page)).toBeHidden({ timeout });
  await expect(page).toHaveURL(CHAT_URL);
}

/**
 * Export on the open review page, once its Export is offered (`timeout`); back in the chat once the run took the
 * answer. Returns when Export was pressed.
 */
export async function exportHere(page: Page, review: Locator, timeout: number): Promise<number> {
  const exportButton = review.locator('[data-slot=review-export]');
  await expect(exportButton).toBeEnabled({ timeout });
  const pressed = Date.now();
  await exportButton.click();
  await backInChat(page, timeout);
  return pressed;
}

/** Export on the card's review page (exportHere). Returns when Export was pressed. */
export async function exportOnReview(page: Page, card: Locator, timeout: number): Promise<number> {
  return exportHere(page, await openReview(page, card), timeout);
}

/** Not now on the card's review page; back in the chat once the run took the answer. */
export async function notNowOnReview(page: Page, card: Locator, timeout: number): Promise<void> {
  const review = await openReview(page, card);
  const notNow = review
    .locator('[data-slot=review-bar]')
    .getByRole('button', { name: 'Not now', exact: true });
  await expect(notNow).toBeEnabled({ timeout });
  await notNow.click();
  await backInChat(page, timeout);
}

/**
 * A quick swap in the review page's Options: clip `clip` (from 0) opens and its first other shot goes in, and the
 * page says it is updating with the swap. The person stays on the page, which the run's next approval comes back
 * to; returns it.
 */
export async function swapOnReview(page: Page, card: Locator, clip: number): Promise<Locator> {
  const review = await openReview(page, card);
  await review.locator('[data-slot=review-options-toggle]').click();
  await review.getByRole('listbox', { name: 'Clips' }).getByRole('option').nth(clip).click();
  const detail = review.locator('[data-slot=clip-detail]');
  await detail
    .getByRole('group', { name: /^Other shots for clip/ })
    .getByRole('button', { name: /^Swap in this shot/ })
    .first()
    .click();
  await expect(
    review.getByRole('status').filter({ hasText: 'Updating with your swap' }).first(),
  ).toBeVisible();
  return review;
}
