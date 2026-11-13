// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · pre-emit critique: P5 H4 E5 S5 R4 V4
 * Hallmark · component: opening choice tile · genre: atmospheric studio app (brand moment: the chat start)
 * system: DESIGN.md v0.4 (UX1: choice tiles, not cards: decision cards stay the only cards)
 * a way in as a tile on the canvas: a rule-subtle hairline, lg radius, no fill, no shadow, no stripe; a top row with
 *   the way's drawn motif (its accent -strong: library teal, reference and template rose, describe violet) and the
 *   trailing sign (an arrow on hover and focus for a way that starts at once, a chevron for one that opens a
 *   panel, a spinner while it starts); under it the name (base, 600) and one line (sm, ink-2)
 * states: default · hover (rule border, hover surface, the motif plays one bar) · focus-visible (the base ring,
 *   instant; the motif plays) · active (pressed surface, scale 0.99) · disabled (a run is going or the way is off:
 *   the reason replaces the line, motif and name in ink-disabled, no play) · loading (the spinner, aria-busy) ·
 *   error (a danger-strong hairline; the cause is the panel row's ErrorLine, named by aria-describedby) · hollow
 *   (Use my library with nothing in it: empty frames, a line that says it opens add a folder or the phone) · open
 *   (aria-expanded: the border in the way's accent -strong, the motif held at play, the chevron turned) · success
 *   (OpeningChoices folds to the way taken)
 * motion: the motif's one bar (opening-motifs.tsx) on whileHover / whileFocus / open; the press scale; the arrow's
 *   4 px slide in. Reduced motion: no play, no scale, no slide; colours change over 150 ms
 * contrast: name ink 7:1, line ink-2 7:1 on canvas and hover; motifs are decorative (accent -strong 4.5:1 anyway)
 */
import type { OpeningPath } from '@taalcut/core';
import { ArrowRight, ChevronDown, LoaderCircle } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '#lib/cn';
import { OpeningMotif } from './opening-motifs';

/** Each way's accent, by its job (DESIGN.md "Four accents, four jobs"): the motif, and the border while open. */
const TONE: Readonly<Record<OpeningPath, { readonly motif: string; readonly open: string }>> = {
  library: { motif: 'text-you-strong', open: 'border-you-strong' },
  reference: { motif: 'text-beat-strong', open: 'border-beat-strong' },
  template: { motif: 'text-area-templates-strong', open: 'border-area-templates-strong' },
  describe: { motif: 'text-ai-strong', open: 'border-ai-strong' },
};

export interface OpeningTileProps {
  path: OpeningPath;
  name: string;
  /** What the way does, or why it is off. */
  line: string;
  /** It opens a panel (a chevron, aria-expanded) instead of starting at once (an arrow). */
  expandable: boolean;
  open: boolean;
  starting: boolean;
  disabled: boolean;
  /** The id of the way's panel, while it is open. */
  panelId: string;
  /** The id of the way's error line, when its start failed. */
  errorId?: string | undefined;
  /** Use my library with nothing in it: the frames are empty, and the line says what opening it does. */
  hollow?: boolean;
  onChoose: () => void;
}

/** One way in, as a tile: the button the onboarding specs click (`li[data-path] > button`). */
export function OpeningTile({
  path,
  name,
  line,
  expandable,
  open,
  starting,
  disabled,
  panelId,
  errorId,
  hollow = false,
  onChoose,
}: OpeningTileProps) {
  const reduce = useReducedMotion() ?? false;
  // Off or waiting, the drawing goes quiet and never plays; under reduced motion it stays still.
  const quiet = disabled && !starting;
  const plays = !reduce && !quiet;
  // The name is all the tile says (name and line: axe's label-content-name-mismatch); the error is its description.
  const failed = errorId !== undefined;
  return (
    <motion.button
      type="button"
      data-slot="opening-tile"
      data-state={failed ? 'error' : open ? 'open' : undefined}
      data-hollow={hollow || undefined}
      disabled={disabled}
      aria-busy={starting || undefined}
      aria-expanded={expandable ? open : undefined}
      aria-controls={expandable && open ? panelId : undefined}
      aria-describedby={errorId}
      onClick={onChoose}
      initial={false}
      animate={plays && open ? 'play' : 'rest'}
      {...(plays ? { whileHover: 'play', whileFocus: 'play' } : {})}
      className={cn(
        'group/tile flex h-full w-full cursor-pointer flex-col gap-3 rounded-lg border bg-transparent px-4 py-3 text-start',
        'transition-[background-color,border-color,scale] duration-(--dur-micro) ease-(--ease-out)',
        'enabled:hover:bg-hover enabled:active:scale-[0.99] enabled:active:bg-pressed motion-reduce:enabled:active:scale-100',
        'disabled:cursor-not-allowed aria-busy:cursor-progress',
        failed
          ? 'border-danger-strong'
          : open
            ? TONE[path].open
            : 'border-rule-subtle enabled:hover:border-rule',
      )}
    >
      <span className="flex w-full items-center justify-between gap-3">
        <OpeningMotif
          path={path}
          hollow={hollow}
          className={cn('flex h-6 w-12 shrink-0', quiet ? 'text-ink-disabled' : TONE[path].motif)}
        />
        <Trailing expandable={expandable} open={open} starting={starting} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('text-base font-semibold text-ink', quiet && 'text-ink-disabled')}>{name}</span>
        <span className="text-sm text-pretty text-ink-2">{line}</span>
      </span>
    </motion.button>
  );
}

/**
 * The sign at the tile's top right: what a click will do, or that it is doing it. A 24 px box, the motif row's
 * height, with room for the chevron's diagonal while it turns and the arrow's slide.
 */
function Trailing(props: { expandable: boolean; open: boolean; starting: boolean }) {
  return (
    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
      <TrailingIcon {...props} />
    </span>
  );
}

function TrailingIcon({
  expandable,
  open,
  starting,
}: {
  expandable: boolean;
  open: boolean;
  starting: boolean;
}) {
  if (starting) return <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-ink-2" />;
  if (expandable)
    return (
      <ChevronDown
        aria-hidden
        className={cn(
          'size-4 shrink-0 text-ink-3 transition-[rotate,color] duration-(--dur-short) ease-(--ease-out)',
          'group-enabled/tile:group-hover/tile:text-ink-2',
          open && 'rotate-180 text-ink-2',
        )}
      />
    );
  return (
    <ArrowRight
      aria-hidden
      className={cn(
        'size-4 shrink-0 -translate-x-1 text-ink-2 opacity-0',
        'transition-[opacity,translate] duration-(--dur-short) ease-(--ease-out)',
        'group-enabled/tile:group-hover/tile:translate-x-0 group-enabled/tile:group-hover/tile:opacity-100',
        'group-focus-visible/tile:translate-x-0 group-focus-visible/tile:opacity-100',
      )}
    />
  );
}
