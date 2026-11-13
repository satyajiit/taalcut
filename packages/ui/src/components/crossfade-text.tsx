// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: crossfade-text · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 (A7) · motion: opacity only, 220 ms (150 ms under reduced motion), the old
 * text out while the new comes in, in the same place · states: n/a (text, not a control) */

import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '#lib/cn';

function Layer({ children, duration }: { children: ReactNode; duration: number }) {
  // The text on its way out is still in the DOM for a moment: screen readers hear only the new one.
  const present = useIsPresent();
  return (
    <motion.span
      aria-hidden={present ? undefined : true}
      className="col-start-1 row-start-1 min-w-0 truncate"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration, ease: 'easeInOut' }}
    >
      {children}
    </motion.span>
  );
}

export interface CrossfadeTextProps {
  /** What the text says: a change of value crossfades, anything else re-renders in place. */
  value: string;
  children: ReactNode;
  className?: string;
}

/**
 * Text that changes while you look at it (a chat's title, once the agent
 * names it) fades from the old words to the new in the same place, instead
 * of jumping. The first value just shows. Keeps truncation: both layers share
 * one grid cell.
 */
export function CrossfadeText({ value, children, className }: CrossfadeTextProps) {
  const reduce = useReducedMotion();
  return (
    <span data-slot="crossfade-text" className={cn('grid min-w-0', className)}>
      <AnimatePresence initial={false}>
        <Layer key={value} duration={reduce ? 0.15 : 0.22}>
          {children}
        </Layer>
      </AnimatePresence>
    </span>
  );
}
