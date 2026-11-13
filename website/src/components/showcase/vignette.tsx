// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a fact's vignette · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (the server HTML, already on screen at load, reduced motion: the vignette's end state, still) ·
 *   waiting (below the fold once the script runs: its start state, out of sight) · playing (once a third of it is on
 *   screen: start to end, under 3 s, then still) · replaying (a mouse or trackpad pointer over its row, or a focus
 *   inside it, plays it again from the start). Decorative: hidden from assistive technology, never focusable; the
 *   fact beside it says the same in words.
 * A small drawn scene that acts its fact out once: transform and opacity only, on the world's ease-out. The vignettes
 * (vignettes-*.tsx) are pure scenes of `on` (start or end) and `from` (whether this mount replays from the start). */

import { motion, type Transition } from 'motion/react';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { finePointer } from '#lib/pointer';

/**
 * What a scene is told: whether it shows its end state, whether it mounts at its start (a replay), and whether a run
 * has started in this browser. A decorative layer whose end state is hidden (a scan, a playhead, a highlight that
 * passes, a row that leaves) renders only once `ran`: the server HTML is the end state, and it never holds a layer at
 * opacity 0.
 */
export interface Scene {
  readonly on: boolean;
  readonly from: boolean;
  readonly reduce: boolean;
  readonly ran: boolean;
}

/** A step of a scene's timeline: `delay` seconds after it starts, on the world's ease-out. */
export function beat(delay: number, reduce: boolean, duration = 0.5): Transition {
  return reduce ? { duration: REDUCED_FADE } : { delay, duration, ease: EASE_OUT };
}

/** A springy pop, for the stickers and chips a scene drops in. */
export function pop(delay: number, reduce: boolean): Transition {
  return reduce
    ? { duration: REDUCED_FADE }
    : { delay, type: 'spring', stiffness: 520, damping: 22, mass: 0.7 };
}

/**
 * The props for a motion element in a scene: its `start` and `end` states, timed by `transition`. On the first mount
 * it starts where the scene is (the server's end state, or the start below the fold); a replay mounts at the start.
 */
export function act<T extends object>(scene: Scene, start: T, end: T, transition: Transition) {
  return {
    initial: scene.from ? start : false,
    animate: scene.on ? end : start,
    // Set back to the start out of sight, at once; only the way to the end is timed.
    transition: scene.on ? transition : { duration: 0 },
  } as const;
}

/** Plays a scene once on arrival and again when a fine pointer comes over `ref`'s row (or a focus lands inside it). */
export function useScene<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce });
  const [replays, setReplays] = useState(0);
  const last = useRef(0);
  const replay = useCallback(() => {
    if (reduce || arrival !== 'shown') return;
    const now = Date.now();
    // One replay at a time: a pointer passing over the row twice in a breath doesn't restart it.
    if (now - last.current < 1600) return;
    last.current = now;
    setReplays((n) => n + 1);
  }, [reduce, arrival]);
  // Derived during render (React's pattern for state that follows a prop), so a hidden-at-the-end layer mounts at its
  // start: below the fold at load (the scene waits at its start), or on the first replay.
  const [ran, setRan] = useState(false);
  if (!ran && (arrival === 'hidden' || replays > 0)) setRan(true);
  const onPointerEnter = useCallback(() => {
    if (finePointer()) replay();
  }, [replay]);
  return {
    ref,
    replay,
    onPointerEnter,
    key: replays,
    scene: { on: arrival === 'shown', from: replays > 0, reduce, ran } satisfies Scene,
  };
}

/** The vignette's stage: a small canvas window on the scene, its size fixed so nothing around it moves. */
export function VignetteFrame({
  children,
  className,
  tone = 'sunken',
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly tone?: 'sunken' | 'viewer';
}) {
  return (
    <div
      aria-hidden
      data-slot="vignette"
      className={cn(
        'relative isolate h-32 w-full overflow-hidden rounded-2xl',
        tone === 'viewer'
          ? 'bg-viewer text-viewer-ink shadow-reel'
          : 'border border-rule-subtle bg-canvas text-ink shadow-sticker',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A small rounded chip inside a scene: a word with an icon, on the raised surface. */
export function SceneChip({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <span
      data-slot="icon-text"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill bg-raised px-2.5 py-1 text-[0.8125rem] leading-none font-semibold whitespace-nowrap text-ink shadow-sticker [&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
    >
      {children}
    </span>
  );
}

export { motion };
