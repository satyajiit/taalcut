// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The ink pill: a demo's one go-ahead (DESIGN.md › The Waitlist Holds the Marigold Rule: the page's marigold is the
 * waitlist's, so a demo's Approve is ink). The secondary button's shape, filled with ink; hover lifts the fill a step,
 * a press gives 2 %, focus is the base ring.
 */
export const INK_PILL =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-pill border border-inverse bg-inverse px-4 ' +
  'type-label font-semibold text-on-inverse select-none transition-[background-color,transform] duration-(--dur-micro) ' +
  'ease-(--ease-out) hover:bg-inverse/85 active:scale-[0.98] motion-reduce:active:scale-100 ' +
  'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-control disabled:text-ink-disabled';
