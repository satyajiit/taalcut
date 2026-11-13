// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: flight layer · mode: Persuade · system: WEB2 Remix Vernacular
 * states: empty · a bar in flight (the template lifting off the reel into the app window, on the world's FLIGHT
 *   spring, with the lift's violet shadow) · clips in flight (one per beat, from the camera roll into their slots,
 *   several at once) · reduced motion (never used: everything lands at once)
 * The stage's shared-layout flights, drawn above the reel and the window. Both frames clip their content (the reel's
 * 28 px corners, the window's 14 px ones), so a flight between them can't live in either: a ghost flies here, from
 * the box it leaves to the box it lands in, and the thing itself shows as the ghost lands. Transform only. Decorative:
 * aria-hidden, never a target. */

import { motion } from 'motion/react';
import type { CSSProperties } from 'react';
import { cn } from '#lib/cn';
import { EASE_OUT, FLIGHT } from '#lib/motion';

/** A box relative to the stage's own box, in px. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Ghost {
  readonly id: string;
  readonly kind: 'bar' | 'clip';
  readonly from: Box;
  readonly to: Box;
  /** A clip's picture (its frame from the atlas). */
  readonly style?: CSSProperties;
  /** A bar's segment count. */
  readonly count?: number;
}

/** The box of `el` relative to `root`, shifted down by `dy` (a scroll still to come). */
export function boxOf(el: Element, root: Element, dy = 0): Box {
  const a = el.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  return { x: a.left - r.left, y: a.top - r.top + dy, w: a.width, h: a.height };
}

/** A clip's flight: quicker than the bar's, so one lands per beat. */
const CLIP_FLIGHT = { duration: 0.42, ease: EASE_OUT } as const;

function GhostBar({ count }: { readonly count: number }) {
  return (
    <span className="flex size-full gap-[2px] rounded-sm shadow-lift">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="h-full min-w-0 flex-1 rounded-[3px] bg-violet" />
      ))}
    </span>
  );
}

export function FlightLayer({ ghosts, onLanded }: { readonly ghosts: readonly Ghost[]; readonly onLanded: (id: string) => void }) {
  return (
    <div aria-hidden data-slot="flight-layer" className="pointer-events-none absolute inset-0 z-40">
      {ghosts.map((g) => (
        <motion.span
          key={g.id}
          data-ghost={g.kind}
          className={cn('absolute block origin-top-left', g.kind === 'clip' && 'overflow-hidden rounded-md shadow-lift')}
          style={{ left: g.to.x, top: g.to.y, width: g.to.w, height: g.to.h, ...(g.kind === 'clip' ? g.style : {}) }}
          initial={{
            x: g.from.x - g.to.x,
            y: g.from.y - g.to.y,
            scaleX: g.to.w > 0 ? g.from.w / g.to.w : 1,
            scaleY: g.to.h > 0 ? g.from.h / g.to.h : 1,
          }}
          animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1 }}
          transition={g.kind === 'bar' ? FLIGHT : CLIP_FLIGHT}
          onAnimationComplete={() => onLanded(g.id)}
        >
          {g.kind === 'bar' ? <GhostBar count={g.count ?? 1} /> : null}
        </motion.span>
      ))}
    </div>
  );
}
