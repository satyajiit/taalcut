// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: the chat start's entrance (timing) · genre: atmospheric studio app · system: DESIGN.md v0.4
 * the new-chat start's one orchestrated entrance: the intro's StaggerGroup cascade (heading, then its line) goes on
 *   through the four tiles and the recipe chips, each an 8 px rise and fade over --dur-short on --ease-out, 45 ms
 *   apart. Never on the in-chat card, first run or history: what was there when a page opened shows at once.
 * reduced motion: a 150 ms fade, all together, nothing moves · states: n/a */
import { motion, useReducedMotion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import { DUR, EASE_OUT, REDUCED_FADE } from '../lib/motion';

/** Seconds between one item and the next (StaggerGroup's stagger in chat/react-bits-motion.tsx). */
const STEP = 0.045;
/** When the first tile starts: after StaggerGroup's 20 ms and the intro's two items (heading, line). */
const AFTER_INTRO = 0.02 + 2 * STEP;

/** The entrance's two poses for item `index` (0 = the first tile). */
export function entranceVariants(reduce: boolean): Variants {
  if (reduce)
    return {
      hidden: { opacity: 0 },
      shown: { opacity: 1, transition: { duration: REDUCED_FADE, ease: 'linear' } },
    };
  return {
    hidden: { opacity: 0, y: 8 },
    shown: (index: number) => ({
      opacity: 1,
      y: 0,
      transition: { duration: DUR.short, ease: EASE_OUT, delay: AFTER_INTRO + index * STEP },
    }),
  };
}

export interface OpeningEntranceProps {
  /** Its place in the cascade after the intro: the tiles are 0 to 3, what follows them comes next. */
  index: number;
  /** Play it (the new-chat start); off, it simply shows. */
  enter: boolean;
  className?: string;
  children: ReactNode;
}

/** Something under the tiles (the recipe chips) that joins the chat start's entrance. */
export function OpeningEntrance({ index, enter, className, children }: OpeningEntranceProps) {
  const reduce = useReducedMotion() ?? false;
  if (!enter) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={entranceVariants(reduce)}
      custom={index}
      initial="hidden"
      animate="shown"
    >
      {children}
    </motion.div>
  );
}
