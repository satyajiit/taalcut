// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The review's sizes (BRK1-REV): how tall the stage (the reel beside the slot) may be, so the strip and the count
 * fit under it in one screen, in the sheet over the chat and on the Slots page. In a short window (42 rem or less,
 * the 960 × 600 window among them) the timeline and the gaps tighten and the stage takes what they give back, so the
 * Slots page needs no scroll of its own: the panel's is the one scroll, and the count stays in view.
 */
/* eslint-disable lingui/no-unlocalized-strings -- CSS lengths and classes, not words */
export const STAGE = {
  sheet: 'max(15rem, calc(100dvh - 23rem))',
  page: 'max(16rem, calc(100dvh - 30rem))',
} as const;
export const STAGE_SHORT = {
  sheet: 'max(15rem, calc(100dvh - 20.5rem))',
  page: 'max(8.75rem, calc(100dvh - 28.75rem))',
} as const;

/** The review's column: its gaps tighten in a short window. */
export const REVIEW_COLUMN = '@container/review flex min-w-0 flex-col gap-4 [@media(max-height:42rem)]:gap-2';

/** The reel beside the slot from 40 rem, at the stage's height (the short one in a short window). */
export const STAGE_ROW =
  'grid grid-cols-1 gap-4 [@media(max-height:42rem)]:gap-2 @[40rem]/review:h-(--stage) ' +
  '@[40rem]/review:[@media(max-height:42rem)]:h-(--stage-short) ' +
  '@[40rem]/review:grid-cols-[minmax(0,1fr)_minmax(17rem,25rem)]';

/** On the Slots page the count, J and K and Undo stay in view when the page scrolls after all (a long translation). */
export const PAGE_NAV = 'sticky bottom-0 z-10 bg-canvas py-1';
/* eslint-enable lingui/no-unlocalized-strings */
