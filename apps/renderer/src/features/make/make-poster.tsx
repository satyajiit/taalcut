// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Make's poster (UX4) · system: DESIGN.md v0.6 + UX4
 * one 9:16 frame for every row in Make, 40 px wide, so a project's and an export's sit at the same size (the
 *   critique's 40 against 48): a picture on the viewer grey; no picture yet, a bone; nothing to show (a project
 *   with no video), a dashed frame with the concept's glyph, never a black tile; dimmed while its export runs
 * states: picture · waiting (bone) · empty (dashed) · running (dimmed); decorative (the row names it)
 */
import { cn, renderIcon, type IconLike } from '@taalcut/ui';

export interface MakePosterProps {
  url: string | null;
  /** Nothing to show: the dashed frame and its glyph. */
  empty?: boolean;
  emptyIcon?: IconLike;
  /** No picture yet, and one is on its way. */
  loading?: boolean;
  /** Its export is still running. */
  dimmed?: boolean;
  /** Row size (40 px) or featured studio lead size (64 px). */
  size?: 'row' | 'featured';
  /** Whether to emit row-specific test slots. */
  trackSlots?: boolean;
}

export function MakePoster({
  url,
  empty = false,
  emptyIcon,
  loading = false,
  dimmed = false,
  size = 'row',
  trackSlots = true,
}: MakePosterProps) {
  const emptySlot = trackSlots ? 'project-poster-empty' : 'featured-poster-empty';
  const posterSlot = trackSlots ? 'make-poster' : 'featured-poster';
  if (empty)
    return (
      <span
        aria-hidden
        data-slot={emptySlot}
        className={cn(
          'flex aspect-[9/16] shrink-0 items-center justify-center border border-dashed border-rule-strong bg-sunken text-ink-3',
          size === 'featured' ? 'w-16 rounded-lg' : 'w-10 rounded-md',
        )}
      >
        {renderIcon(emptyIcon, size === 'featured' ? 'md' : 'sm')}
      </span>
    );
  return (
    <span
      aria-hidden
      data-slot={posterSlot}
      className={cn(
        'block aspect-[9/16] shrink-0 bg-viewer bg-cover bg-center ring-1 ring-rule-subtle',
        size === 'featured' ? 'w-16 rounded-lg' : 'w-10 rounded-md',
        !url && loading && 'tc-bone',
        dimmed && 'opacity-60',
      )}
      style={url ? { backgroundImage: `url("${url}")` } : undefined}
    />
  );
}
