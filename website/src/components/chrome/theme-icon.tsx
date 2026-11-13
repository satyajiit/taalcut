// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: theme icon (sun ↔ moon), ported from the app (packages/ui/src/theme/theme-icon.tsx)
 * mode: Persuade (site chrome) · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 · states: n/a (an icon; ThemeToggle carries the states)
 * motion: the sun's disc grows into a crescent as a shadow slides across it, its rays turn away and fade; transform and
 *   opacity only, --dur-short on --ease-in-out, after `delay` (the toggle waits for the scene's horizon to reach it).
 *   Reduced motion: the shapes switch at once. */

import { motion } from 'motion/react';
import { useId } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_IN_OUT } from '#lib/motion';

/* Lucide's sun rays, on its 24-unit grid with 2 px round strokes, so the icon sits with the rest. */
const RAYS = [
  'M12 2v2',
  'M12 20v2',
  'm4.93 4.93 1.41 1.41',
  'm17.66 17.66 1.41 1.41',
  'M2 12h2',
  'M20 12h2',
  'm6.34 17.66-1.41 1.41',
  'm19.07 4.93-1.41 1.41',
];

/* The moon's shadow: a circle that crosses the disc. Off to the top right while it is the sun. */
const SHADOW = { cx: 17.5, cy: 6.5, r: 6.5 };
const AWAY = { x: 10, y: -10 };
const ABOUT_CENTRE = { transformOrigin: '12px 12px', transformBox: 'view-box' } as const;

export interface ThemeIconProps {
  /** Which one it is now; a change morphs from the other. */
  readonly theme: 'light' | 'dark';
  /** ms before a change starts to morph. */
  readonly delay?: number;
  readonly reduce?: boolean;
  readonly className?: string;
}

/** Sun for light, moon for dark, in Lucide's line style; switching morphs one into the other. */
export function ThemeIcon({ theme, delay = 0, reduce = false, className }: ThemeIconProps) {
  const id = `theme-icon-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const dark = theme === 'dark';
  const transition = reduce ? { duration: 0 } : { duration: DUR.short, ease: EASE_IN_OUT, delay: delay / 1000 };
  const shadow = { x: dark ? 0 : AWAY.x, y: dark ? 0 : AWAY.y };
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-slot="theme-icon"
      data-theme-icon={theme}
      className={cn('size-5 shrink-0', className)}
    >
      <defs>
        <mask id={`${id}-shadow`} maskUnits="userSpaceOnUse" x="-12" y="-12" width="48" height="48">
          <rect x="-12" y="-12" width="48" height="48" fill="white" />
          <motion.circle {...SHADOW} fill="black" initial={false} animate={shadow} transition={transition} />
        </mask>
        <clipPath id={`${id}-disc`}>
          <circle cx="12" cy="12" r="8" />
        </clipPath>
      </defs>
      <motion.g initial={false} animate={{ scale: dark ? 1 : 0.5 }} transition={transition} style={ABOUT_CENTRE}>
        <circle cx="12" cy="12" r="8" mask={`url(#${id}-shadow)`} vectorEffect="non-scaling-stroke" />
        <g clipPath={`url(#${id}-disc)`}>
          <motion.circle {...SHADOW} initial={false} animate={shadow} transition={transition} vectorEffect="non-scaling-stroke" />
        </g>
      </motion.g>
      <motion.g
        initial={false}
        animate={{ opacity: dark ? 0 : 1, scale: dark ? 0.6 : 1, rotate: dark ? -45 : 0 }}
        transition={transition}
        style={ABOUT_CENTRE}
      >
        {RAYS.map((d) => (
          <path key={d} d={d} />
        ))}
      </motion.g>
    </svg>
  );
}
