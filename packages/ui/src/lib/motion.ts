// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The motion tokens (design/tokens/source.mjs, DESIGN.md "Motion") as
 * motion/react takes them: seconds and cubic-bézier points. CSS reads the
 * same values as --ease-* and --dur-*; test/motion-tokens.test.ts keeps the
 * two in step.
 */
export type Bezier = [number, number, number, number];

/** Elements entering. */
export const EASE_OUT: Bezier = [0.16, 1, 0.3, 1];
/** Elements leaving. */
export const EASE_IN: Bezier = [0.7, 0, 0.84, 0];
/** State toggles. */
export const EASE_IN_OUT: Bezier = [0.65, 0, 0.35, 1];

/** Seconds: --dur-micro, --dur-short, --dur-long. */
export const DUR = { micro: 0.12, short: 0.22, long: 0.42 } as const;

/** Under reduced motion spatial motion becomes a fade of at most this long (DESIGN.md). */
export const REDUCED_FADE = 0.15;

/**
 * The motion grammar's numbers (UX4, `_orch/ux4/specs/design-kit.md`). A control gives under a press by 2 %; a
 * row or a tile, being wider, by 1 %, so both move about the same few pixels.
 */
export const PRESS_SCALE = { control: 0.98, row: 0.99 } as const;

/** How far something that arrives rises into place (px), as `Arrival` does. */
export const RISE = 8;

/**
 * A list that arrives as a list: each item `step` seconds after the one before, never more than `cap` in all, so
 * a long list is never a wait. Items that join an open list arrive on their own, with no delay.
 */
export const STAGGER = { step: 0.04, cap: 0.24 } as const;

/** The delay before the item at `index` arrives, in seconds: capped, so the 40th item waits as long as the 7th. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, index) * STAGGER.step, STAGGER.cap);
}

/** A count that changes in place ticks from the old number to the new one over this long (seconds). */
export const TICK_DURATION = DUR.long;

/** A button's success tick stays this long before the caller may settle it back (ms). */
export const SUCCESS_HOLD_MS = 1600;

/** A bézier as CSS writes it, for the Web Animations API and inline styles. */
export function cssEase(points: Bezier): string {
  return `cubic-bezier(${points.join(', ')})`;
}

/**
 * The eased value of a cubic bézier at time `t` (0–1), as CSS computes it,
 * for working out where an animation running on the compositor has got to.
 */
export function bezierAt([x1, y1, x2, y2]: Bezier, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const curve = (a: number, b: number, u: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
  // Bisection on x (monotonic for CSS easings): 24 steps is well under a pixel.
  let low = 0;
  let high = 1;
  let u = t;
  for (let i = 0; i < 24; i += 1) {
    u = (low + high) / 2;
    if (curve(x1, x2, u) < t) low = u;
    else high = u;
  }
  return curve(y1, y2, u);
}

/** The sidebar's two widths (px): open (w-60) and the icon rail (w-14). */
export const SIDEBAR_WIDTH = { open: 240, rail: 56 } as const;

/** How far the sidebar's edge travels when it folds (px). */
export const FOLD_DISTANCE = SIDEBAR_WIDTH.open - SIDEBAR_WIDTH.rail;

/**
 * The fold, in ms: one continuous movement on --ease-out, the sidebar, the
 * page beside it and the window bar's band together (--dur-short).
 */
export const FOLD_MS = DUR.short * 1000;
