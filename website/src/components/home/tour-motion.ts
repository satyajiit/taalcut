// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The home demos' variants, named for useReplay's two states: 'shown' is the finished demo (the server HTML), and
 * 'hidden' the frame a run starts from. Each takes the second it plays at, so a demo is one script of delays,
 * always under five seconds (WCAG 2.2.2). Transform and opacity only; a playhead or a scan crosses on x.
 */
import type { Variants } from 'motion/react';
import { EASE_OUT, POP } from '#lib/motion';

const SNAP = { duration: 0 } as const;

/** A sticker's pop: from 60 % and nothing, on the world's one spring. */
export function pop(at: number): Variants {
  return { hidden: { opacity: 0, scale: POP.scale, transition: SNAP }, shown: { opacity: 1, scale: 1, transition: { ...POP.spring, delay: at } } };
}

/** Rise 10 px and fade in. */
export function rise(at: number): Variants {
  return { hidden: { opacity: 0, y: 10, transition: SNAP }, shown: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT, delay: at } } };
}

/** Grow from nothing along one axis (a cut mark, a beat tick, a clip landing on its track). */
export function grow(at: number, axis: 'x' | 'y' = 'y'): Variants {
  const shown = { duration: 0.32, ease: EASE_OUT, delay: at };
  return axis === 'x'
    ? { hidden: { scaleX: 0, transition: SNAP }, shown: { scaleX: 1, transition: shown } }
    : { hidden: { scaleY: 0, transition: SNAP }, shown: { scaleY: 1, transition: shown } };
}

/** A playhead crossing its track once, from the left edge to `to` (a share of the track), linear. At rest it sits at `to`. */
export function sweep(at: number, seconds: number, to = 1): Variants {
  return {
    hidden: { x: '0%', transition: SNAP },
    shown: { x: `${to * 100}%`, transition: { duration: seconds, ease: 'linear', delay: at } },
  };
}

/** Typing: the words uncover left to right. */
export function type(at: number, seconds: number): Variants {
  return {
    hidden: { clipPath: 'inset(0 100% 0 0)', transition: SNAP },
    shown: { clipPath: 'inset(0 0% 0 0)', transition: { duration: seconds, ease: 'linear', delay: at } },
  };
}

/** Fade to a share of full, for what steps back once the AI has picked. */
export function dim(at: number, to: number): Variants {
  return { hidden: { opacity: 1, transition: SNAP }, shown: { opacity: to, transition: { duration: 0.5, ease: EASE_OUT, delay: at } } };
}
