// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the phone, picking clips · mode: Persuade · system: WEB2 Remix Vernacular (teal is yours)
 * states: resting (the server HTML and reduced motion: three clips picked, on their way) · arriving (once on screen,
 *   the three ticks pop in turn and the clips start over the Wi-Fi) · the ticks lean with the pointer. Not a control:
 *   one image, named in words for assistive technology.
 * A coded phone beside the pairing window: the page Taalcut opens in the phone's own browser, its camera roll as a
 * grid of the owner's clips, three of them ticked in teal, and the line that says they are coming over the Wi-Fi. */

import { Check, Wifi } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef } from 'react';
import { Logo } from '#components/brand/logo';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { POP } from '#lib/motion';
import { ClipFrame } from '../frame';
import { SAMPLE_ROLL } from './roll';

/** The clips the phone shows (its own: the raw clips "Vietnam, on repeat" was cut from), and which are picked. */
const SHOWN = SAMPLE_ROLL.filter((c) => c.id.startsWith('repeat-')).slice(0, 12);
const PICKED: readonly string[] = ['repeat-04', 'repeat-06', 'repeat-11'];

export function PhoneMock({ className }: { readonly className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce });
  return (
    <div
      ref={ref}
      role="img"
      aria-label="The phone’s browser, open on Taalcut’s page: its camera roll, three clips picked, coming over your Wi-Fi"
      className={cn('relative aspect-[9/16] w-full rounded-[2.25rem] bg-viewer p-2 shadow-reel', className)}
    >
      <div className="flex size-full flex-col overflow-hidden rounded-[1.75rem] bg-canvas">
        <div className="flex h-9 shrink-0 items-center justify-center">
          <span className="h-4.5 w-16 rounded-pill bg-viewer" />
        </div>
        <div className="flex items-center gap-2 px-3.5 pb-2.5">
          <Logo kind="symbol" className="size-4" />
          <span className="text-[0.8125rem] font-semibold text-ink">Pick your clips</span>
        </div>
        <ul className="m-0 grid list-none grid-cols-4 gap-1 p-0 px-1.5">
          {SHOWN.map((clip) => {
            const turn = PICKED.indexOf(clip.id);
            const picked = turn !== -1;
            const delay = 0.25 + turn * 0.22;
            return (
              <li key={clip.id} className="relative">
                <ClipFrame
                  sprite={clip.sprite}
                  className={cn('w-full rounded-sm', picked && 'ring-2 ring-teal ring-inset')}
                />
                {picked ? (
                  <motion.span
                    className="absolute top-1 right-1 inline-grid size-4.5 place-items-center rounded-pill bg-teal text-teal-ink"
                    initial={false}
                    animate={arrival === 'shown' ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
                    transition={arrival === 'shown' && !reduce ? { ...POP.spring, delay } : { duration: 0 }}
                  >
                    <Check strokeWidth={ICON_STROKE + 1} className="size-3" />
                  </motion.span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="mt-auto p-2.5">
          <span className="flex h-9 items-center justify-center gap-2 rounded-pill bg-teal-soft text-[0.75rem] font-semibold text-teal-strong">
            <Wifi strokeWidth={ICON_STROKE} className="size-3.5" />
            {PICKED.length} clips coming over Wi-Fi
          </span>
        </div>
      </div>
    </div>
  );
}
