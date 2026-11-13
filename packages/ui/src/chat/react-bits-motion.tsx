// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: react-bits-motion · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 + the UX4 motion grammar · React Bits' AnimatedContent / SplitText stagger adapted to
 *   Taalcut tokens: a few blocks (an empty state's words, a chat start) arriving in turn, 8 px rise and fade, 40 ms
 *   apart, transform and opacity only, still under reduced motion. A list that arrives as a list is ArrivalList
 *   (capped stagger). UX4 removed the unused PulseAura, StreamingCaret and MagneticHover (a cursor effect the
 *   system forbids). */

import { motion, useReducedMotion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import { DUR, EASE_OUT, RISE, STAGGER } from '../lib/motion';

const GROUP_VARIANTS: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: STAGGER.step,
      delayChildren: 0.02,
    },
  },
};

const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: RISE },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: DUR.short,
      ease: EASE_OUT,
    },
  },
};

export interface StaggerGroupProps {
  children: ReactNode;
  className?: string;
  /** Disable entrance animation (e.g., when replaying static history). */
  animate?: boolean;
}

/**
 * React Bits `AnimatedContent` / `SplitText` staggered cascade container:
 * sequences child `StaggerItem` blocks with a subtle rise and fade.
 */
export function StaggerGroup({ children, className, animate = true }: StaggerGroupProps) {
  const reduce = useReducedMotion();
  if (!animate || reduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={GROUP_VARIANTS}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export interface StaggerItemProps {
  children: ReactNode;
  className?: string;
}

/** One staggered unit inside a `StaggerGroup`. */
export function StaggerItem({ children, className }: StaggerItemProps) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div variants={ITEM_VARIANTS} className={className}>
      {children}
    </motion.div>
  );
}
