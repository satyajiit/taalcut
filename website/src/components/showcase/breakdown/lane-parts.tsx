// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the breakdown lanes' parts · mode: Operate · system: WEB2 Remix Vernacular
 * states: the live playhead hidden (the reel not started) or following the reel's clock; a mark at rest or striking
 *   as the arrival's playhead passes; a lane's label (from 40rem). Not controls: the lanes' cuts are
 *   (breakdown-lanes.tsx).
 * The pieces the lanes draw with: the marigold playhead that follows the reel playing beside them, the strike each
 * beat and cut gives as the arrival reads the reel, a label held inside the lane near either end, and a lane's name. */

import { motion, type MotionValue, useMotionValueEvent, useTransform } from 'motion/react';
import { useState } from 'react';
import { cn } from '#lib/cn';
import { DUR, SETTLE } from '#lib/motion';
import type { SHOWCASE_ICONS } from '../icons';

/** How long the arrival's playhead takes to read the reel. */
export const SWEEP = 1.8;

/**
 * A marigold line at the reel's time, moved by transform. It mounts the first time the reel's clock moves, so the
 * server HTML (the reel not started) holds no playhead at opacity 0; after that it hides whenever the clock is at 0.
 */
export function LivePlayhead({
  time,
  duration,
}: {
  readonly time: MotionValue<number>;
  readonly duration: number;
}) {
  const x = useTransform(
    time,
    (t) => `${(Math.min(Math.max(t, 0), duration) / Math.max(duration, 0.001)) * 100}%`,
  );
  const opacity = useTransform(time, (t) => (t > 0.01 ? 1 : 0));
  const [started, setStarted] = useState(false);
  useMotionValueEvent(time, 'change', (t) => {
    if (!started && t > 0.01) setStarted(true);
  });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[3] overflow-hidden">
      {started ? (
        <motion.span className="absolute inset-0 block" style={{ x, opacity }}>
          <span className="absolute inset-y-0 left-0 w-0.5 -translate-x-px rounded-pill bg-playhead-strong" />
          <span className="absolute -top-0.5 left-0 size-2 -translate-x-1/2 rounded-pill bg-playhead-strong" />
        </motion.span>
      ) : null}
    </div>
  );
}

/** A beat or cut striking as the arrival's playhead passes it (transform only). */
export function strike(play: boolean, at: number, duration: number) {
  if (!play) return {};
  return {
    animate: { scaleY: [1, 1.9, 1] },
    transition: {
      delay: 0.15 + (at / duration) * SWEEP,
      duration: DUR.long,
      ease: SETTLE,
      times: [0, 0.2, 1],
    },
  };
}

/** A label centred on a time, held inside the lane near either end. */
export function anchor(at: number, duration: number): string {
  const edge = at / Math.max(duration, 0.001);
  return edge < 0.08 ? '' : edge > 0.92 ? '-translate-x-full' : '-translate-x-1/2';
}

/** A lane's name in the label column, with its icon. */
export function Label({
  children,
  icon: Icon,
  tone = 'text-ink-3',
  className,
}: {
  readonly children: string;
  readonly icon: typeof SHOWCASE_ICONS.beat;
  readonly tone?: string;
  readonly className: string;
}) {
  return (
    <span
      className={cn('hidden items-center gap-1.5 type-meta whitespace-nowrap text-ink-2 sm:flex', className)}
    >
      <Icon aria-hidden className={cn('size-3.5 shrink-0', tone)} />
      {children}
    </span>
  );
}
