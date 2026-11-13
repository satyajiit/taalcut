// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The motion numbers for JavaScript, the same as the tokens' CSS (design/tokens/tailwind.css: --dur-*, --ease-*).
 * test/unit/motion.test.ts keeps them in step. The logo's strike and settle come from design/logo/motion.
 */
export const DUR = { micro: 0.12, short: 0.22, long: 0.42 } as const;

/** Cubic-bezier control points, for motion/react's `ease`. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN = [0.7, 0, 0.84, 0] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;
/** The logo's settle: a slightly softer ease-out for a stroke's decay (design/logo/motion/README.md). */
export const SETTLE = [0.22, 1, 0.36, 1] as const;

/** Arrival: rise 8 px and fade, 40 ms apart, the cascade capped at 240 ms (DESIGN.md › Motion). */
export const RISE = 8;
export const STAGGER = 0.04;
export const STAGGER_CAP = 0.24;
export function staggerDelay(index: number): number {
  return Math.min(index * STAGGER, STAGGER_CAP);
}

/** Under reduced motion every change is this fade, and nothing moves. */
export const REDUCED_FADE = 0.15;

/** The fastest the logo may keep time: 1.5 strokes a second (design/logo/motion, Tempo). */
export const KEEP_TIME_MIN_BEAT_MS = 667;

/** A tempo folded into the logo's range (60–180 music beats a minute), as a beat length in ms, never under the cap. */
export function keepTimeBeatMs(tempo: number): number {
  let t = tempo;
  while (t > 180) t /= 2;
  while (t < 60) t *= 2;
  return Math.max(60_000 / t, KEEP_TIME_MIN_BEAT_MS);
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* WEB2 Remix Vernacular: the world's motion grammar. Transform and opacity only; reduced motion shows the finished  */
/* state (the components check useReducedMotionPref and skip these).                                                */
/* ---------------------------------------------------------------------------------------------------------------- */

/**
 * A section's one orchestrated arrival (components/ui/section.tsx): its parts rise 16 px and fade in, 70 ms apart,
 * the cascade capped, on the exponential ease-out. Played once, the first time a third of it is on screen.
 */
export const ARRIVE = { rise: 16, duration: 0.6, stagger: 0.07, cap: 0.42 } as const;

/** The share of an element that must be on screen before it arrives (IntersectionObserver threshold). */
export const ARRIVE_AMOUNT = 0.3;

/**
 * A sticker's pop and settle (components/ui/sticker.tsx): from 60 % and 12° past its tilt, a quick spring that
 * overshoots a hair and lands. Stickers are the world's one bounce, with Kaatu.
 */
export const POP = { scale: 0.6, turn: 12, spring: { type: 'spring', stiffness: 560, damping: 20, mass: 0.7 } } as const;

/** How far a sticker leans toward the pointer, at most, in px; and the soft spring it follows on. */
export const DRIFT = { max: 6, spring: { stiffness: 110, damping: 16, mass: 0.6 } } as const;

/** The segment bar lifting off a reel and flying into the app window (shared layout). */
export const FLIGHT = { type: 'spring', stiffness: 240, damping: 30, mass: 0.9 } as const;

/** A rose beat tick swells this much as the playhead crosses it, and for this long. */
export const BEAT_PULSE = { scale: 1.9, seconds: 0.18 } as const;
