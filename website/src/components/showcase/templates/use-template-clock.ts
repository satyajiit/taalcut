// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import type { MotionValue } from 'motion/react';
import { type RefObject, useEffect, useState } from 'react';

/**
 * The template's one clock, in seconds, for your version and the template beside it. While the saved reel plays
 * (`following`), it reads the reel's own time, so the saved reel and your version cut on the same frames; otherwise it
 * runs on its own, round the template's length. It runs only while `running`.
 */
export function useDriveClock(
  clock: MotionValue<number>,
  {
    duration,
    follow,
    following,
    running,
  }: {
    readonly duration: number;
    readonly follow: MotionValue<number>;
    readonly following: boolean;
    readonly running: boolean;
  },
): void {
  useEffect(() => {
    if (!running || duration <= 0) return undefined;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // A frame that took long (a hidden tab, a stall) moves the clock one frame's worth at most.
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      clock.set(following ? follow.get() : (clock.get() + dt) % duration);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock, duration, follow, following, running]);
}

/** Whether `ref` is at least `amount` on screen (a video plays only then), and whether the tab is shown. */
export function useOnScreen(ref: RefObject<Element | null>, amount = 0.5): boolean {
  const [onScreen, setOnScreen] = useState(false);
  const [tabShown, setTabShown] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen((entry?.intersectionRatio ?? 0) >= amount),
      { threshold: [0, amount, 1] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, amount]);
  useEffect(() => {
    const update = () => setTabShown(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return onScreen && tabShown;
}
