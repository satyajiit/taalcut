// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';

// Horizontal lockup, small drawing (for 100–159 px wide), from design/logo/kit.
// Colours come from the --color-logo-* tokens, so they follow the theme. The
// dark drawing has slightly wider cuts, so each theme gets its own geometry.
const WORDMARK =
  'M324.07 60.8L343.49 60.8L343.49 83.2L362.9 83.2L362.9 100.37L343.49 100.37L343.49 172.8L324.07 172.8L324.07 100.37L307.65 100.37L307.65 83.2L324.07 83.2ZM448.02 83.2L467.43 83.2L467.43 172.8L448.02 172.8L448.02 166.07A47.04 47.04 0 1 1 448.02 89.93ZM448.02 128A27.63 27.63 0 1 0 392.77 128A27.63 27.63 0 1 0 448.02 128ZM557.03 83.2L576.45 83.2L576.45 172.8L557.03 172.8L557.03 166.07A47.04 47.04 0 1 1 557.03 89.93ZM557.03 128A27.63 27.63 0 1 0 501.78 128A27.63 27.63 0 1 0 557.03 128ZM592.87 41.39L612.29 41.39L612.29 172.8L592.87 172.8ZM709.02 161.26A47.04 47.04 0 1 1 709.02 94.74L695.29 108.46A27.63 27.63 0 1 0 695.29 147.54ZM731.75 83.2L751.17 83.2L751.17 130.24A25.39 25.39 0 0 0 776.55 155.63A25.39 25.39 0 0 0 801.94 130.24L801.94 83.2L821.35 83.2L821.35 172.8L801.94 172.8L801.94 167.15A44.8 44.8 0 0 1 731.75 130.24ZM849.73 60.8L869.14 60.8L869.14 83.2L888.55 83.2L888.55 100.37L869.14 100.37L869.14 172.8L849.73 172.8L849.73 100.37L833.3 100.37L833.3 83.2L849.73 83.2Z';

/** The four beats of the Avartan symbol, clockwise from the top (beat one is sam). */
export const AVARTAN_BEATS = {
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

// Four-colour: marigold, rose, violet, teal (act, beats, AI, your footage).
// Two-colour: beat one in the accent, the rest in ink.
export const AVARTAN_FOUR_COLOUR_FILLS = ['fill-logo-1', 'fill-logo-2', 'fill-logo-3', 'fill-logo-4'] as const;

const FILLS = {
  'four-colour': AVARTAN_FOUR_COLOUR_FILLS,
  'two-colour': ['fill-logo-1', 'fill-logo-ink', 'fill-logo-ink', 'fill-logo-ink'],
} as const;

export interface LogoProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Accessible name, translated by the caller (the brand name). */
  label: string;
  /** Two-colour is the everyday version; four-colour is for brand moments (onboarding, About). */
  colourway?: 'two-colour' | 'four-colour';
}

/** The Taalcut lockup. Never retype the wordmark in Onest (DESIGN.md). Keep it 100 px wide or more. */
export function Logo({ label, colourway = 'two-colour', className, ...props }: LogoProps) {
  return (
    <span
      role="img"
      aria-label={label}
      data-slot="logo"
      className={cn('inline-flex h-7.5 shrink-0', className)}
      {...props}
    >
      {(['light', 'dark'] as const).map((theme) => (
        <svg
          key={theme}
          viewBox="0 0 905 256"
          aria-hidden
          className={cn('h-full w-auto', theme === 'light' ? 'block dark:hidden' : 'hidden dark:block')}
        >
          {AVARTAN_BEATS[theme].map((d, i) => (
            <path key={d} className={FILLS[colourway][i]} fillRule="evenodd" d={d} />
          ))}
          <path className="fill-logo-ink" fillRule="evenodd" d={WORDMARK} />
        </svg>
      ))}
    </span>
  );
}
