// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: arrival · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 (A7) · the chat's one entrance: opacity + 8 px, 220 ms, ease-out;
 * reduced motion: opacity only, 150 ms · states: n/a */

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { DUR, EASE_OUT, REDUCED_FADE } from '#lib/motion';

export interface ArrivalProps {
  /** Play the entrance. Off for what was already there (history), so a page never animates in. */
  animate: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * New things in the chat arrive the same way (DESIGN.md v0.2, A7: one
 * entrance per screen, transform and opacity only, motion/react). Things
 * that were already there when the page opened just show.
 */
export function Arrival({ animate, className, children }: ArrivalProps) {
  const reduce = useReducedMotion();
  if (!animate) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduce ? { duration: REDUCED_FADE, ease: 'linear' } : { duration: DUR.short, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
