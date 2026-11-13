// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: lean chip · a row's tilted icon chip that leans a few px toward a mouse or trackpad pointer
 * mode: Persuade · system: WEB2 Remix Vernacular (DRIFT, as a Section's heading icon does)
 * states: resting (server HTML, touch screens, reduced motion) · leaning (a fine pointer nearby). Decorative and
 *   aria-hidden: the row's words carry the meaning. Not a control. */

import { motion } from 'motion/react';
import { type ReactNode, useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { usePointerDrift } from '#lib/pointer';

export function LeanChip({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotionPref();
  const lean = usePointerDrift(ref, { enabled: !reduce, max: 4 });
  return (
    <motion.span ref={ref} aria-hidden style={{ x: lean.x, y: lean.y }} className={className}>
      {children}
    </motion.span>
  );
}
