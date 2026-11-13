// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: page arrival · a block of a page that rises into place when it first comes on screen
 * mode: Persuade · system: WEB2 Remix Vernacular (ARRIVE: rise 16 px and fade on the exponential ease-out)
 * states: arrived (the server HTML, anything on screen at load, reduced motion: the finished state) · arriving (below
 *   the fold at load, once JavaScript runs: hidden out of sight, then it rises when a third of it shows). Not a control.
 * For the blocks of /contact/, /download/ and /waitlist/ that aren't a <Section>. */

import { motion } from 'motion/react';
import { type ReactNode, useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { useArrival } from '#lib/arrival';
import { ARRIVE, EASE_OUT } from '#lib/motion';

export function PageArrival({
  children,
  delay = 0,
  className,
}: {
  readonly children: ReactNode;
  /** Seconds after it comes on screen. */
  readonly delay?: number;
  readonly className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce });
  return (
    <motion.div
      ref={ref}
      data-arrival={arrival}
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
