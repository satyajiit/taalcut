// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: saved-reels carousel · mode: Persuade (Reels vernacular) · system: WEB2 Remix Vernacular
 * Under the reel, one 9:16 poster per saved reel: choosing one plays it in the frame and re-cuts the app window on
 * its beats (a new pass from the lift). With a single reel there is nothing to choose, and it doesn't render.
 * states: default · hover (its rule darkens) · focus (base ring) · active (2 % give) · chosen (aria-pressed, lifted
 *   4 px, a 2 px ink ring) · poster missing (viewer grey under the reel glyph) · reduced motion (no lift motion) */

import { motion } from 'motion/react';
import { smallPoster } from '#content/reels';
import type { Reel } from '#content/schema';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { DUR, EASE_OUT } from '#lib/motion';
import { DEMO } from './copy';

export interface ShelfProps {
  readonly reels: readonly Reel[];
  readonly chosenId: string;
  readonly onChoose: (id: string) => void;
  readonly className?: string;
}

export function Shelf({ reels, chosenId, onChoose, className }: ShelfProps) {
  const choosable = reels.filter((r) => !r.placeholder);
  if (choosable.length < 2) return null;
  return (
    <div role="group" aria-label={DEMO.reels} data-slot="reel-carousel" className={cn('flex justify-center gap-2.5', className)}>
      {choosable.map((reel) => {
        const chosen = reel.id === chosenId;
        return (
          <button
            key={reel.id}
            type="button"
            data-reel={reel.id}
            aria-pressed={chosen}
            aria-label={`${reel.label}: ${reel.title}`}
            onClick={() => onChoose(reel.id)}
            className="group rounded-lg transition-transform duration-(--dur-micro) ease-(--ease-out) active:scale-[0.98] motion-reduce:active:scale-100"
          >
            <motion.span
              className={cn(
                'relative block aspect-[9/16] w-12 overflow-hidden rounded-lg bg-viewer',
                chosen ? 'ring-2 ring-ink' : 'ring-1 ring-rule group-hover:ring-rule-strong',
              )}
              initial={false}
              animate={{ y: chosen ? -4 : 0 }}
              transition={{ duration: DUR.short, ease: EASE_OUT }}
            >
              <span aria-hidden className="absolute inset-0 grid place-items-center text-viewer-ink-2">
                <ICONS.reel strokeWidth={ICON_STROKE} className="size-4" />
              </span>
              <span aria-hidden className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${smallPoster(reel.id) ?? reel.poster})` }} />
            </motion.span>
          </button>
        );
      })}
    </div>
  );
}
