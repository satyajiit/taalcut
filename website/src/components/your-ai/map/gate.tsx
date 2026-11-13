// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the map's gate · mode: Persuade · system: WEB2 Remix Vernacular
 * states: open (a dashed border with a pass for each thing that crosses: its glyph and an arrow, in ink) · playing
 *   (a faint copy of each pass slides through the gate, again and again, transform and opacity only) · walled (Local
 *   only: a solid teal wall fades in down the border, teal because it is yours, with its shield; only the update
 *   check's pass stays) · reduced motion (no slides; the wall's fade is 150 ms) · without JavaScript (open).
 *   Decorative: the cards' captions and the switch say the same.
 * The border between your computer and outside it, as a gate: upright between the zones from 1024 px, and across
 * the map on a phone, where things pass down through it. */

import { ArrowDown, ArrowRight, Bug, Link2, type LucideIcon, Mic, RefreshCw, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { DUR, EASE_IN_OUT, EASE_OUT, REDUCED_FADE } from '#lib/motion';
import type { LaneId } from './model';

const GLYPHS: Readonly<Record<LaneId, LucideIcon>> = { cloud: ICONS.chat, links: Link2, speech: Mic, reports: Bug, updates: RefreshCw };

/** One trip through the gate, and the rest between trips, in seconds, while the map plays. */
const TRIP = 1.6;
const TRIP_REST = 2.6;

/** A layer that fades in when it mounts (never in the server HTML) and out when it goes. */
export function FadeLayer({ show, reduce, className, children }: { readonly show: boolean; readonly reduce: boolean; readonly className: string; readonly children?: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.span
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? REDUCED_FADE : DUR.long, ease: EASE_OUT }}
          className={className}
        >
          {children}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

/** A pass: what crosses, and which way. */
function Pass({ id }: { readonly id: LaneId }) {
  const Glyph = GLYPHS[id];
  return (
    <span className="inline-flex h-7 items-center gap-0.5 rounded-pill bg-ink px-2 text-canvas shadow-sticker">
      <Glyph strokeWidth={ICON_STROKE} className="size-3.5" />
      <ArrowRight strokeWidth={2.5} className="size-3 max-lg:hidden" />
      <ArrowDown strokeWidth={2.5} className="size-3 lg:hidden" />
    </span>
  );
}

export function Gate({ crossing, wall, travelling, wide, reduce }: {
  /** The lanes crossing now, top to bottom. */
  readonly crossing: readonly LaneId[];
  readonly wall: boolean;
  readonly travelling: boolean;
  /** Upright (from 1024 px) or across (a phone): the way the passes slide. */
  readonly wide: boolean;
  readonly reduce: boolean;
}) {
  return (
    <div aria-hidden data-slot="map-gate" data-walled={wall ? 'true' : 'false'} className="relative isolate h-14 bg-canvas lg:h-auto">
      {/* The border itself: across on a phone, upright from 1024 px. */}
      <span className="absolute border-dashed border-ink-3 max-lg:inset-x-0 max-lg:top-1/2 max-lg:border-t-2 lg:inset-y-0 lg:left-1/2 lg:border-l-2" />
      <FadeLayer
        show={wall}
        reduce={reduce}
        className="absolute z-10 rounded-pill bg-teal-strong max-lg:inset-x-0 max-lg:top-1/2 max-lg:h-1.5 max-lg:-translate-y-1/2 lg:inset-y-0 lg:left-1/2 lg:w-1.5 lg:-translate-x-1/2"
      >
        <span data-slot="map-wall" className="absolute inline-grid size-9 place-items-center rounded-pill bg-teal-strong text-teal-strong-ink shadow-sticker max-lg:top-1/2 max-lg:left-4 max-lg:-translate-y-1/2 lg:top-6 lg:left-1/2 lg:-translate-x-1/2">
          <ShieldCheck strokeWidth={ICON_STROKE} className="size-4.5" />
        </span>
      </FadeLayer>
      <ul className="absolute inset-0 z-20 m-0 flex list-none items-center justify-evenly p-0 max-lg:ps-14 lg:flex-col lg:py-20">
        {crossing.map((id, i) => (
          <motion.li key={id} layout={reduce ? false : 'position'} data-slot="map-pass" data-lane={id} className="relative">
            <Pass id={id} />
            {travelling ? (
              // A faint copy slides through the gate, from your side to the other, while the map plays.
              <motion.span
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={wide ? { x: ['-2.5rem', '2.5rem'], opacity: [0, 0.6, 0.6, 0] } : { y: ['-1.75rem', '1.75rem'], opacity: [0, 0.6, 0.6, 0] }}
                transition={{ duration: TRIP, ease: EASE_IN_OUT, repeat: Infinity, repeatDelay: TRIP_REST, delay: 0.3 + i * 0.5 }}
              >
                <Pass id={id} />
              </motion.span>
            ) : null}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
