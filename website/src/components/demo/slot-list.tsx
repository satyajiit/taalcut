// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: slot list · mode: Persuade (product UI: the app's cast grid) · system: WEB2 Remix Vernacular
 * One row per slot of the template, in the /download/ window's row layout: the picked clip, "Slot 1 · Hook" with the
 * music beats the slot covers (in rose), what the slot needs in its own words, then the violet AI pick chip, how sure
 * the AI is (the word beside a three-step meter) and where the slot starts on the reel. Never a reason per pick. Four
 * rows show at once; the list steps through all of them as the picks land.
 * states: empty (no template yet: what fills it) · waiting (the template's rows, each with a dashed frame and
 *   "Waiting for a clip") · landing (the clip flies in, the chip and the meter fill) · filled · scrolled (it follows
 *   the landing row; a visitor can scroll it by wheel, touch or keyboard: the list is a focusable region) · focus
 *   (the base ring on the region) · reduced motion (the rows and picks fade in, 150 ms)
 * Every word is 13 design px or more and nothing is cut short; the window lays out at 1 px a design px from 320 up. */

import { AudioLines } from 'lucide-react';
import { motion } from 'motion/react';
import { forwardRef, type CSSProperties } from 'react';
import { GROUP_WORDS } from '#components/ui/segments';
import { IconText } from '#components/ui/icon-text';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { DEMO } from '#components/hero/copy';
import { AiPickChip } from './ai-pick-chip';
import { Confidence } from './confidence';
import type { SlotRow } from './hero-model';

/** Rows the list shows at once; the rest scroll. */
export const VISIBLE_ROWS = 4;

/** A pick's thumbnail: a grid post's 3:4 crop of its frame. */
export const THUMB_ASPECT = 3 / 4;

export interface SlotListProps {
  /** Null before the template is taken. */
  readonly rows: readonly SlotRow[] | null;
  /** Picks whose flight has landed. */
  readonly arrived: ReadonlySet<number>;
  /** Each slot's pick, as a 3:4 crop of its frame. */
  readonly thumbs: readonly CSSProperties[];
  readonly reduce: boolean;
}

function Row({ row, filled, thumb, reduce }: { readonly row: SlotRow; readonly filled: boolean; readonly thumb: CSSProperties | undefined; readonly reduce: boolean }) {
  return (
    <motion.li
      data-slot-row={row.index}
      data-filled={filled || undefined}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? REDUCED_FADE : 0.34, ease: EASE_OUT, delay: reduce ? 0 : Math.min(row.index * 0.04, 0.36) }}
      className="flex h-18 items-center gap-2.5 border-b border-rule-subtle px-1 last:border-b-0"
    >
      <span className="relative aspect-[3/4] w-11 shrink-0 rounded-md" data-flight-to={`clip-${row.index}`}>
        <span className="absolute inset-0 rounded-md border border-dashed border-rule-strong bg-sunken" />
        {filled ? (
          <motion.span
            className="absolute inset-0 rounded-md bg-sunken"
            style={thumb}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduce ? REDUCED_FADE : 0.08 }}
          />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span data-slot="slot-title" className="type-label-sm font-semibold whitespace-nowrap text-ink">
            {DEMO.slotTitle(row.index + 1, GROUP_WORDS[row.role])}
          </span>
          {row.beats ? (
            <span data-slot="slot-beats" className="inline-flex shrink-0 items-center gap-1 self-center type-label-sm font-medium whitespace-nowrap text-rose-strong">
              <AudioLines aria-hidden strokeWidth={ICON_STROKE} className="size-3.5" />
              {DEMO.beats(row.beats[0], row.beats[1])}
            </span>
          ) : null}
        </span>
        <span data-slot="slot-needs" className="type-label-sm text-pretty text-ink-2">
          {row.needs}
        </span>
        <span className="flex h-5.5 items-center gap-2">
          {filled ? (
            <motion.span initial={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: reduce ? REDUCED_FADE : 0.26, ease: EASE_OUT }}>
              <AiPickChip />
            </motion.span>
          ) : (
            <span className="type-label-sm whitespace-nowrap text-ink-3">{DEMO.waiting}</span>
          )}
          <Confidence level={row.level} filled={filled} className="type-label-sm" />
          <span data-slot="slot-at" className="ms-auto shrink-0 type-label-sm font-mono tabular-nums text-ink-3">
            {row.at}
          </span>
        </span>
      </span>
    </motion.li>
  );
}

export const SlotList = forwardRef<HTMLDivElement, SlotListProps>(function SlotList({ rows, arrived, thumbs, reduce }, ref) {
  return (
    <div
      ref={ref}
      role="region"
      aria-label={DEMO.slots}
      tabIndex={rows ? 0 : -1}
      data-slot="slot-list"
      className={cn('relative box-content h-72 overflow-y-auto overscroll-contain rounded-md border border-rule-subtle bg-canvas px-1.5 [scrollbar-width:thin]', !rows && 'grid place-items-center')}
    >
      {rows ? (
        <ol className="flex flex-col">
          {rows.map((row) => (
            <Row key={row.index} row={row} filled={arrived.has(row.index)} thumb={thumbs[row.index]} reduce={reduce} />
          ))}
        </ol>
      ) : (
        <IconText icon={ICONS.template} tone="muted" className="max-w-64 px-4 type-label-sm text-ink-2">
          {DEMO.empty}
        </IconText>
      )}
    </div>
  );
});
