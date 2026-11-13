// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The ink pill: a demo's go-ahead in lane P's showcases (plugins, product videos, Instagram Edits). DESIGN.md's
 * one-marigold rule: the page's one marigold fill is Download for Mac, so a demo's Approve, Go
 * ahead or Stage is `site-inverse` ink. The secondary button's shape filled with ink; hover lifts the fill a step, a
 * press gives 2 %, focus is the base ring, disabled takes the control face.
 */
export const INK_PILL =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-pill border border-inverse bg-inverse px-4 ' +
  'type-label font-semibold text-on-inverse select-none transition-[background-color,transform] duration-(--dur-micro) ' +
  'ease-(--ease-out) not-disabled:hover:bg-inverse/85 not-disabled:active:scale-[0.98] motion-reduce:active:scale-100 ' +
  'aria-busy:cursor-progress disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-control disabled:text-ink-disabled';
