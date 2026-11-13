// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a part's arrival · mode: Persuade · system: WEB2 Remix Vernacular
 * states: arrived (the server HTML, already on screen at load, reduced motion: in its place, fully shown) · waiting
 *   (below the fold once the script runs: 16 px low and clear, out of sight) · arriving (once a third of it is on
 *   screen: it rises into place and fades in, on the world's ease-out, `delay` seconds after its neighbours). Not a
 *   control.
 * The section arrival (components/ui/section.tsx) for a part outside a Section: an index row's words and its window,
 * the showcase's heading, the next feature. Server HTML never starts at opacity 0 (#lib/arrival). */

import { motion } from 'motion/react';
import { type ReactNode, useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { useArrival } from '#lib/arrival';
import { ARRIVE, EASE_OUT } from '#lib/motion';

export function Rise({
  children,
  className,
  delay = 0,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce });
  return (
    <motion.div
      ref={ref}
      data-rise={arrival}
      initial={false}
      animate={arrival}
      variants={{
        hidden: { opacity: 0, y: ARRIVE.rise, transition: { duration: 0 } },
        shown: { opacity: 1, y: 0, transition: { duration: ARRIVE.duration, ease: EASE_OUT, delay } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
