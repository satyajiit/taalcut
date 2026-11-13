// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: cost bar · mode: Persuade · system: WEB2 Remix Vernacular
 * states: filled (the finished state: the server HTML, reduced motion, at rest) · filling (in a run: the segments fill
 *   one a beat, stories style, then the bracket draws out under what is left and its stickers pop) · stickers lean
 *   toward a fine pointer. Not a control: no hover, focus, disabled, loading or error.
 * One price as the world's segment bar, on the hired editor's scale: ten segments of a tenth of the editor's price ($500 each)
 * each, filled in the way's colour job (ink for the editor, violet for a cloud AI, teal for your computer), the rest an
 * empty track. Nearly nothing is a teal sliver in the first segment. Under the empty segments a teal bracket (teal is
 * yours: the money stays with you) carries the saving and the change as stickers. Drawn bars are hidden from
 * assistive technology: the row's words say every figure. */

import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';
import { Sticker, type StickerField } from '#components/ui/sticker';
import { cn } from '#lib/cn';
import { grow, pop } from './tour-motion';

/** Segments on the bar: the editor's price in tenths, so the cloud AI's $500 is exactly one. */
export const SEGMENTS = 10;
/** Seconds between two segments filling. */
export const STEP = 0.08;

export type CostJob = 'ink' | 'ai' | 'you';

const FILL: Readonly<Record<CostJob, string>> = { ink: 'bg-ink-2', ai: 'bg-violet', you: 'bg-teal' };

/** How many of the ten segments a price fills, rounded to whole segments. */
export function segmentsFor(usd: number, scale: number): number {
  return Math.min(SEGMENTS, Math.max(0, Math.round((usd / scale) * SEGMENTS)));
}

export interface CostBarProps {
  readonly filled: number;
  readonly job: CostJob;
  /** Nearly nothing: a sliver in the first segment instead of whole ones. */
  readonly sliver?: boolean;
  /** Second the first segment starts filling, in a run. */
  readonly at: number;
  readonly className?: string;
}

export function CostBar({ filled, job, sliver = false, at, className }: CostBarProps) {
  return (
    <div aria-hidden data-slot="cost-bar" data-filled={filled} className={cn('grid grid-cols-10 gap-1', className)}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span key={i} data-slot="cost-segment" className="relative h-3.5 overflow-hidden rounded-[4px] bg-rule sm:h-4">
          {i < filled ? <motion.span variants={grow(at + i * STEP, 'x')} className={cn('absolute inset-0 origin-left', FILL[job])} /> : null}
          {sliver && i === 0 ? <motion.span variants={grow(at, 'x')} className={cn('absolute inset-y-0 left-0 w-1 origin-left rounded-e-[2px]', FILL[job])} /> : null}
        </span>
      ))}
    </div>
  );
}

export interface SavedSticker {
  readonly words: ReactNode;
  readonly field: StickerField;
  readonly icon: LucideIcon;
  readonly tilt: number;
  readonly size: 'md' | 'lg';
}

export interface SavedProps {
  /** The first empty segment, where the bracket starts (0-based). */
  readonly from: number;
  readonly stickers: readonly SavedSticker[];
  /** Second the bracket starts drawing, in a run; the stickers pop after it. */
  readonly at: number;
  readonly className?: string;
}

/**
 * The bracket under a bar's empty segments, opening up toward them, and the stickers it carries: the saving and the
 * change. The stickers sit at the bracket's start, where the spending stopped.
 */
export function Saved({ from, stickers, at, className }: SavedProps) {
  // The stickers hang from the bracket's start from 640 px; on a phone they take the bar's whole width, so they never
  // run past the board's edge.
  return (
    <div className={cn('grid grid-cols-10 gap-x-1', className)} style={{ '--saved-from': from + 1 } as CSSProperties}>
      <motion.span
        aria-hidden
        data-slot="cost-saved"
        variants={grow(at, 'x')}
        className="mt-1.5 h-2.5 origin-left rounded-b-sm border-x-[1.5px] border-b-[1.5px] border-teal-strong col-start-(--saved-from) col-end-13"
      />
      <span aria-hidden className="col-span-full flex flex-wrap items-center gap-2 pt-2.5 sm:col-start-(--saved-from) sm:col-end-13 sm:ps-1">
        {stickers.map((s, i) => (
          <motion.span key={i} variants={pop(at + 0.2 + i * 0.12)} className="inline-flex">
            {/* The climax's large stickers come down to the medium size on a phone, so they fit a 320 px screen. */}
            <Sticker
              field={s.field}
              icon={s.icon}
              tilt={s.tilt}
              size={s.size}
              pop={false}
              className={s.size === 'lg' ? 'max-sm:gap-1.5 max-sm:px-3.5 max-sm:py-1.5 max-sm:[font-size:0.875rem] max-sm:[&_svg]:size-4' : undefined}
            >
              {s.words}
            </Sticker>
          </motion.span>
        ))}
      </span>
    </div>
  );
}
