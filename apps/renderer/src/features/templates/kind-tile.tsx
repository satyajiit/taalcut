// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: kind tiles (UX3) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6
 * the Templates page's tiles (starters, built-in formats): raised plates with a rule edge, so they read in dark,
 *   in a wrapping grid of equal heights; each leads with its format's icon on its family's wash (kinds)
 * states: default · hover (hover surface, rule-strong edge) · focus-visible (base ring) · active (pressed); the
 *   tiles' own states are their callers'
 */
import type { FormatId } from '@taalcut/core';
import { cn, FAMILY_TONE, FORMAT_KIND } from '@taalcut/ui';

/** Tiles at least this wide, as many to a row as fit; every row as tall as the tallest tile. */
export const TILE_GRID =
  'm-0 grid list-none auto-rows-fr grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3 p-0';

/** A tile on the Templates page: a raised plate with an edge that reads in both themes (UX3). */
export const TILE = cn(
  'group flex w-full cursor-pointer flex-col gap-1 rounded-lg border border-rule bg-raised p-3 text-start shadow-xs',
  'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:border-rule-strong hover:bg-hover active:bg-pressed',
);

/** A tile's kind mark: the format's icon on its family's wash. */
export function KindMark({ formatId }: { readonly formatId: FormatId }) {
  const kind = FORMAT_KIND[formatId];
  const tone = FAMILY_TONE[kind.family];
  const Icon = kind.icon;
  return (
    <span
      aria-hidden
      data-family={kind.family}
      className={cn('flex size-7 shrink-0 items-center justify-center rounded-md', tone.soft, tone.strong)}
    >
      <Icon className="size-4" />
    </span>
  );
}
