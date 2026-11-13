// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: sticker · mode: Persuade · system: WEB2 Remix Vernacular
 * states: resting (tilted on its field) · arriving (pops from 60 % and settles on a spring, once, when it comes on
 *   screen) · drifting (leans a few px toward a mouse or trackpad pointer) · reduced motion (resting, no pop, no
 *   drift) · without JavaScript (resting). Not a control: no hover, focus, disabled, loading or error of its own.
 * A rounded, tilted chip that carries a fact ("23 music beats", "13 slots", "Your version") in a sticker field, with
 * an optional Lucide or brand icon. Decoration and facts, never state, and never the only carrier of meaning: what it
 * says is also said in the page's words or the demo's own UI. The server HTML is the resting sticker, fully visible. */

import { motion } from 'motion/react';
import { type ReactNode, useRef } from 'react';
import { BrandIcon, type BrandIconId } from '#components/brand/brand-icon';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { ICON_STROKE, type IconRef, iconOf } from '#lib/icons';
import { POP } from '#lib/motion';
import { usePointerDrift } from '#lib/pointer';

export type StickerField = 'pink' | 'violet' | 'teal' | 'marigold' | 'sky' | 'lime' | 'paper';

export const STICKER_FIELDS: Readonly<Record<StickerField, string>> = {
  pink: 'bg-sticker-pink text-sticker-pink-ink',
  violet: 'bg-sticker-violet text-sticker-violet-ink',
  teal: 'bg-sticker-teal text-sticker-teal-ink',
  marigold: 'bg-sticker-marigold text-sticker-marigold-ink',
  sky: 'bg-sticker-sky text-sticker-sky-ink',
  lime: 'bg-sticker-lime text-sticker-lime-ink',
  paper: 'bg-sticker-paper text-sticker-paper-ink',
};

const SIZES = {
  sm: { box: 'gap-1 px-2.5 py-1 [font-size:0.8125rem]', icon: 'size-3.5' },
  md: { box: 'gap-1.5 px-3.5 py-1.5', icon: 'size-4' },
  lg: { box: 'gap-2 px-4.5 py-2.5 [font-size:clamp(1rem,0.6vw+0.85rem,1.375rem)]', icon: 'size-5' },
} as const;

export interface StickerProps {
  readonly children: ReactNode;
  readonly field?: StickerField;
  /** A Lucide icon, or its name in #lib/icons (what a server component can pass). */
  readonly icon?: IconRef;
  readonly brand?: BrandIconId;
  /** Any other drawn mark before the words (the AI's mark). */
  readonly mark?: ReactNode;
  /** Degrees, clockwise. A few degrees either way; 0 sits level. */
  readonly tilt?: number;
  readonly size?: keyof typeof SIZES;
  /** Pop in when it comes on screen (default). */
  readonly pop?: boolean;
  /** Seconds after its section starts arriving: stagger stickers on one reel. */
  readonly delay?: number;
  /** Lean toward a fine pointer (default). */
  readonly drift?: boolean;
  readonly className?: string;
}

export function Sticker({ children, field = 'pink', icon, brand, mark, tilt = -3, size = 'md', pop = true, delay = 0, drift = true, className }: StickerProps) {
  const Icon = icon ? iconOf(icon) : undefined;
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce: reduce || !pop });
  const lean = usePointerDrift(ref, { enabled: drift && !reduce });
  const s = SIZES[size];
  const turn = tilt >= 0 ? POP.turn : -POP.turn;
  return (
    <motion.span
      ref={ref}
      data-slot="sticker"
      data-field={field}
      initial={false}
      animate={arrival}
      variants={{
        hidden: { scale: POP.scale, rotate: tilt + turn, opacity: 0, transition: { duration: 0 } },
        shown: { scale: 1, rotate: tilt, opacity: 1, transition: { ...POP.spring, delay } },
      }}
      style={{ x: lean.x, y: lean.y }}
      className={cn('inline-flex w-max items-center whitespace-nowrap rounded-sticker shadow-sticker type-sticker select-none', s.box, STICKER_FIELDS[field], className)}
    >
      {/* The glyph beside its words, as IconText pairs them (the brand rule reads data-slot="icon-text"); `contents`
          keeps the sticker's own row. */}
      <span data-slot="icon-text" className="contents">
        {Icon ? <Icon aria-hidden strokeWidth={ICON_STROKE + 0.25} className={cn('shrink-0', s.icon)} /> : null}
        {!Icon && brand ? <BrandIcon id={brand} themeAware={false} className={cn('shrink-0', s.icon)} /> : null}
        {!Icon && !brand && mark ? <span aria-hidden className={cn('inline-flex shrink-0', s.icon)}>{mark}</span> : null}
        <span>{children}</span>
      </span>
    </motion.span>
  );
}
