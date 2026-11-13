// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: ai-mark · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 · states: n/a (static mark) */

import type { LucideIcon, LucideProps } from 'lucide-react';
import { forwardRef, type ComponentProps } from 'react';
import { cn } from '#lib/cn';

// The four beats of the Avartan symbol (clockwise from sam at the top) + central AI core,
// so the mark reads as a balanced circular studio emblem rather than a lone half-arc slice.
const AVARTAN_BEATS = {
  light: [
    'M142.45 16.88A112 112 0 0 1 232.16 85.72L167.15 103.14A46 46 0 0 0 142.45 84.18Z',
    'M239.41 112.76A112 112 0 0 1 142.45 239.12L142.45 192.5A66 66 0 0 0 194.37 124.83Z',
    'M114.45 239.12A112 112 0 0 1 24.73 170.28L55.99 161.91A80 80 0 0 0 114.45 206.77Z',
    'M17.49 143.24A112 112 0 0 1 114.45 16.88L114.45 63.5A66 66 0 0 0 62.52 131.17Z',
  ],
  dark: [
    'M142.95 16.94A112 112 0 0 1 231.97 85.25L168.89 102.15A48 48 0 0 0 142.95 82.24Z',
    'M239.47 113.26A112 112 0 0 1 142.95 239.06L142.95 194.44A68 68 0 0 0 196.37 124.81Z',
    'M113.95 239.06A112 112 0 0 1 24.93 170.75L55.22 162.63A81 81 0 0 0 113.95 207.69Z',
    'M17.42 142.74A112 112 0 0 1 113.95 16.94L113.95 61.56A68 68 0 0 0 60.52 131.19Z',
  ],
} as const;

const CENTER_CORE = 'M128 92L139 117L164 128L139 139L128 164L117 139L92 128L117 117Z';

function AvartanPaths({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <g className={theme === 'light' ? 'dark:hidden' : 'hidden dark:inline'}>
      {AVARTAN_BEATS[theme].map((d, index) => (
        <path
          key={d}
          fillRule="evenodd"
          d={d}
          className={index === 2 ? undefined : 'opacity-45'}
        />
      ))}
      <path d={CENTER_CORE} />
    </g>
  );
}

export interface AiMarkProps extends Omit<ComponentProps<'svg'>, 'children'> {
  /** Accessible name when the mark stands alone; without it the mark is decoration. */
  label?: string;
}

/**
 * The AI mark (DESIGN.md v0.3, A1): the four-beat Avartan wheel with beat three
 * and the central studio core emphasized in AI violet.
 */
export function AiMark({ label, className, ...props }: AiMarkProps) {
  return (
    <svg
      viewBox="14 14 228 228"
      data-slot="ai-mark"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cn('inline-block size-3.5 shrink-0 fill-ai-strong', className)}
      {...props}
    >
      <AvartanPaths theme="light" />
      <AvartanPaths theme="dark" />
    </svg>
  );
}

/**
 * The AI mark where an icon goes (the Agent area in the sidebar and ⌘K): the
 * complete Avartan emblem in the text colour, so it follows the row's states
 * like the Lucide icons beside it (ink-3 at rest, the area's violet when current).
 */
export const AiMarkIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(function AiMarkIcon(
  { className, size, absoluteStrokeWidth: _absolute, nonScalingStroke: _nonScaling, ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      viewBox="14 14 228 228"
      data-slot="ai-mark"
      aria-hidden
      focusable="false"
      {...(size === undefined ? {} : { width: size, height: size })}
      className={cn('inline-block shrink-0 fill-current', className)}
      {...props}
    >
      <AvartanPaths theme="light" />
      <AvartanPaths theme="dark" />
    </svg>
  );
});
