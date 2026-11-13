// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The filter pill's look, as the Library's (features/library/filter-pill.tsx) draws it, for the menus Templates and
 * the hub add beside it (tags, trend, sort): one idiom for filtering everywhere (UX1 M11).
 */
import { cn } from '@taalcut/ui';

export const PILL_CLASS = cn(
  'group inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill border border-rule px-3 text-sm whitespace-nowrap text-ink-2',
  'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink active:bg-pressed',
  'data-[state=open]:bg-pressed data-[state=open]:text-ink',
  'data-[set]:border-primary-strong data-[set]:bg-selected data-[set]:text-ink',
  'disabled:cursor-not-allowed disabled:text-ink-disabled disabled:hover:bg-transparent',
  '[&_svg]:size-3.5 [&_svg]:shrink-0',
);

/** The chevron's turn while the menu is open. */
export const PILL_CHEVRON_CLASS =
  'text-ink-3 transition-transform duration-(--dur-micro) ease-(--ease-out) group-data-[state=open]:rotate-180';
