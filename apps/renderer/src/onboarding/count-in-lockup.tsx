// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: count-in-lockup · genre: atmospheric studio app (brand moment) · system: DESIGN.md v0.2
 * motion: the logo count-in (design/logo/motion/README.md §5.1), once on mount; reduced motion: a 150 ms fade
 * states: n/a (an image, not a control)
 */
import { cn } from '@taalcut/ui';
import { useLayoutEffect, useRef } from 'react';

/*
 * The four-colour lockup, playing the count-in once: the arcs arrive on beats
 * 1, 3, 6 and 8 of jhaptaal (2+3+2+3), the empty beat fades in instead of
 * dropping, then beat one lands and the wordmark enters. Numbers come from
 * design/logo/motion/choreography.js; geometry from mark-geometry.js (LOCKUP,
 * standard drawing on light, the thinned "reversed" drawing on dark). It runs
 * on the Web Animations API, transform and opacity only, so it needs no
 * library and nothing inline that the CSP would block.
 */

const ARCS = {
  light: [
    'M137.45 16.36A112 112 0 0 1 233.95 90.41L175.59 106.05A52 52 0 0 0 137.45 76.78Z',
    'M238.61 107.8A112 112 0 0 1 137.45 239.64L137.45 201.45A74 74 0 0 0 201.72 117.68Z',
    'M119.45 239.64A112 112 0 0 1 22.94 165.59L42.34 160.39A92 92 0 0 0 119.45 219.56Z',
    'M18.28 148.2A112 112 0 0 1 119.45 16.36L119.45 54.55A74 74 0 0 0 55.17 138.32Z',
  ],
  dark: [
    'M137.95 16.4A112 112 0 0 1 233.78 89.94L177.33 105.07A54 54 0 0 0 137.95 74.84Z',
    'M238.7 108.29A112 112 0 0 1 137.95 239.6L137.95 203.4A76 76 0 0 0 203.74 117.66Z',
    'M118.95 239.6A112 112 0 0 1 23.11 166.06L41.54 161.12A93 93 0 0 0 118.95 220.51Z',
    'M18.19 147.71A112 112 0 0 1 118.95 16.4L118.95 52.6A76 76 0 0 0 53.15 138.34Z',
  ],
} as const;

const WORDMARK =
  'M324.07 60.8L343.49 60.8L343.49 83.2L362.9 83.2L362.9 100.37L343.49 100.37L343.49 172.8L324.07 172.8L324.07 100.37L307.65 100.37L307.65 83.2L324.07 83.2ZM448.02 83.2L467.43 83.2L467.43 172.8L448.02 172.8L448.02 166.07A47.04 47.04 0 1 1 448.02 89.93ZM448.02 128A27.63 27.63 0 1 0 392.77 128A27.63 27.63 0 1 0 448.02 128ZM557.03 83.2L576.45 83.2L576.45 172.8L557.03 172.8L557.03 166.07A47.04 47.04 0 1 1 557.03 89.93ZM557.03 128A27.63 27.63 0 1 0 501.78 128A27.63 27.63 0 1 0 557.03 128ZM592.87 41.39L612.29 41.39L612.29 172.8L592.87 172.8ZM709.02 161.26A47.04 47.04 0 1 1 709.02 94.74L695.29 108.46A27.63 27.63 0 1 0 695.29 147.54ZM731.75 83.2L751.17 83.2L751.17 130.24A25.39 25.39 0 0 0 776.55 155.63A25.39 25.39 0 0 0 801.94 130.24L801.94 83.2L821.35 83.2L821.35 172.8L801.94 172.8L801.94 167.15A44.8 44.8 0 0 1 731.75 130.24ZM849.73 60.8L869.14 60.8L869.14 83.2L888.55 83.2L888.55 100.37L869.14 100.37L869.14 172.8L849.73 172.8L849.73 100.37L833.3 100.37L833.3 83.2L849.73 83.2Z';

// Marigold (beat one), rose, violet (the empty beat), teal: clockwise from the top.
const FILLS = ['fill-logo-1', 'fill-logo-2', 'fill-logo-3', 'fill-logo-4'] as const;

// choreography.js: arcs, easing and timing for the count-in.
const BISECTORS = [-52.5, 37.5, 127.5, 217.5]; // degrees, 0 = right, clockwise
const KHALI = 2;
const MATRA = 125; // ms per beat in the count-in
const GROUP_STARTS = [0, 2, 5, 7];
const ARRIVE = { from: 16, fade: 90, settle: 380, soft: 280 };
const LANDING = { push: 12, attack: 90, decay: 520 };
const WORD = { from: -10, delay: 40, fade: 240, settle: 420 };
const REDUCED_FADE = 150;
/* eslint-disable lingui/no-unlocalized-strings -- CSS easing and transform values, not text */
const EASE = {
  strike: 'cubic-bezier(0.16, 1, 0.3, 1)',
  settle: 'cubic-bezier(0.22, 1, 0.36, 1)',
  wave: 'cubic-bezier(0.65, 0, 0.35, 1)',
};

/** A push of `units` outward along an arc's centre line, as a CSS transform in user units. */
function push(arc: number, units: number): string {
  const angle = ((BISECTORS[arc] ?? 0) * Math.PI) / 180;
  return `translate(${(Math.cos(angle) * units).toFixed(2)}px, ${(Math.sin(angle) * units).toFixed(2)}px)`;
}
/* eslint-enable lingui/no-unlocalized-strings */

function play(svg: SVGSVGElement, reduced: boolean): Animation[] {
  if (reduced) {
    return [
      svg.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: REDUCED_FADE,
        easing: 'linear',
        fill: 'both',
      }),
    ];
  }
  const out: Animation[] = [];
  const arcs = svg.querySelectorAll<SVGGElement>('[data-arc]');
  arcs.forEach((group) => {
    const arc = Number(group.dataset.arc);
    const at = (GROUP_STARTS[arc] ?? 0) * MATRA;
    if (arc === KHALI) {
      out.push(
        group.animate([{ opacity: 0 }, { opacity: 1 }], {
          delay: at,
          duration: ARRIVE.soft,
          easing: EASE.wave,
          fill: 'both',
        }),
      );
      return;
    }
    out.push(
      group.animate([{ opacity: 0 }, { opacity: 1 }], {
        delay: at,
        duration: ARRIVE.fade,
        easing: EASE.strike,
        fill: 'both',
      }),
      group.animate([{ transform: push(arc, ARRIVE.from) }, { transform: push(arc, 0) }], {
        delay: at,
        duration: ARRIVE.settle,
        easing: EASE.settle,
        fill: 'backwards',
      }),
    );
    if (arc === 0) {
      // Beat eleven is beat one again: the landing, the largest move.
      const landing = 10 * MATRA;
      const total = LANDING.attack + LANDING.decay;
      out.push(
        group.animate(
          [
            { transform: push(0, 0), offset: 0, easing: EASE.strike },
            { transform: push(0, LANDING.push), offset: LANDING.attack / total, easing: EASE.settle },
            { transform: push(0, 0), offset: 1 },
          ],
          { delay: landing, duration: total, composite: 'replace' },
        ),
      );
    }
  });
  const word = svg.querySelector<SVGGElement>('[data-word]');
  if (word) {
    const at = 10 * MATRA + WORD.delay;
    out.push(
      word.animate([{ opacity: 0 }, { opacity: 1 }], {
        delay: at,
        duration: WORD.fade,
        easing: EASE.strike,
        fill: 'both',
      }),
      word.animate([{ transform: `translateX(${WORD.from}px)` }, { transform: 'translateX(0px)' }], {
        delay: at,
        duration: WORD.settle,
        easing: EASE.settle,
        fill: 'backwards',
      }),
    );
  }
  return out;
}

export interface CountInLockupProps {
  /** Accessible name, translated by the caller (the brand name). */
  label: string;
  className?: string;
}

/** The welcome screen's lockup: four colours, counting itself in once. Size it by height (120–160 px). */
export function CountInLockup({ label, className }: CountInLockupProps) {
  const light = useRef<SVGSVGElement>(null);
  const dark = useRef<SVGSVGElement>(null);

  // Before the first paint, so the arcs never flash at rest before the count-in.
  useLayoutEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const animations = [light.current, dark.current].flatMap((svg) =>
      svg && typeof svg.animate === 'function' ? play(svg, reduced) : [],
    );
    return () => animations.forEach((animation) => animation.cancel());
  }, []);

  return (
    <span
      role="img"
      aria-label={label}
      data-slot="count-in-lockup"
      className={cn('inline-flex h-32', className)}
    >
      {(['light', 'dark'] as const).map((theme) => (
        <svg
          key={theme}
          ref={theme === 'light' ? light : dark}
          viewBox="0 0 905 256"
          aria-hidden
          className={cn(
            'h-full w-auto overflow-visible',
            theme === 'light' ? 'block dark:hidden' : 'hidden dark:block',
          )}
        >
          {ARCS[theme].map((d, i) => (
            <g key={d} data-arc={i}>
              <path className={FILLS[i]} fillRule="evenodd" d={d} />
            </g>
          ))}
          <g data-word>
            <path className="fill-logo-ink" fillRule="evenodd" d={WORDMARK} />
          </g>
        </svg>
      ))}
    </span>
  );
}
