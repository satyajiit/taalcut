// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Avartan mark (chrome, small drawing) · genre: atmospheric studio app · theme: custom (DESIGN.md v0.2)
 * states: static, not a control; inactive window: ink-3. Never animated in the window bar (logo motion spec).
 */
import type { ComponentProps } from 'react';
import { cn } from '#lib/cn';

/*
 * The Avartan symbol alone, small drawing (16–39 px, design/logo/kit): wider
 * cuts and a heavier first beat, so the cuts stay open at 16 px. Light and
 * dark each have their own drawing (the dark one, "small-reversed", has
 * slightly wider cuts against light-on-dark glow), as in the lockup (Logo).
 * Clockwise from the top; beat one is sam.
 */
const BEATS = {
  light: [
    'M142 16.88A112 112 0 0 1 231.71 85.72L166.7 103.14A46 46 0 0 0 142 84.18Z',
    'M238.96 112.76A112 112 0 0 1 142 239.12L142 192.5A66 66 0 0 0 193.92 124.83Z',
    'M114 239.12A112 112 0 0 1 24.29 170.28L55.54 161.91A80 80 0 0 0 114 206.77Z',
    'M17.04 143.24A112 112 0 0 1 114 16.88L114 63.5A66 66 0 0 0 62.08 131.17Z',
  ],
  dark: [
    'M142.5 16.94A112 112 0 0 1 231.52 85.25L168.45 102.15A48 48 0 0 0 142.5 82.24Z',
    'M239.03 113.26A112 112 0 0 1 142.5 239.06L142.5 194.44A68 68 0 0 0 195.93 124.81Z',
    'M113.5 239.06A112 112 0 0 1 24.48 170.75L54.78 162.63A81 81 0 0 0 113.5 207.69Z',
    'M16.97 142.74A112 112 0 0 1 113.5 16.94L113.5 61.56A68 68 0 0 0 60.07 131.19Z',
  ],
} as const;

/*
 * Two-colour (the everyday version): beat one in the accent, the rest in ink.
 * When the window is not the active one, the whole mark rests in ink-3, the
 * way a silent beat is written: the symbol keeps its shape, not its colour.
 */
const FILLS = [
  cn('fill-logo-1', 'window-inactive:fill-ink-3'),
  cn('fill-logo-ink', 'window-inactive:fill-ink-3'),
  cn('fill-logo-ink', 'window-inactive:fill-ink-3'),
  cn('fill-logo-ink', 'window-inactive:fill-ink-3'),
];

export interface AvartanMarkProps extends Omit<ComponentProps<'span'>, 'children'> {
  /**
   * Accessible name, translated by the caller. Leave it out where the mark
   * sits beside the words it stands for (the window bar): it is then hidden
   * from assistive technology.
   */
  label?: string;
}

/**
 * The Taalcut symbol for chrome: 16 px by default (never smaller), never
 * animated in the window bar (logo motion spec). Keep a quarter of its width
 * clear on every side.
 */
export function AvartanMark({ label, className, ...props }: AvartanMarkProps) {
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-slot="avartan-mark"
      className={cn('inline-flex size-4 shrink-0', className)}
      {...props}
    >
      {(['light', 'dark'] as const).map((theme) => (
        <svg
          key={theme}
          viewBox="16 16 224 224"
          aria-hidden
          className={cn('size-full', theme === 'light' ? 'block dark:hidden' : 'hidden dark:block')}
        >
          {BEATS[theme].map((d, i) => (
            <path key={d} className={FILLS[i]} fillRule="evenodd" d={d} />
          ))}
        </svg>
      ))}
    </span>
  );
}
