// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useEffect, useRef, useState } from 'react';

/** Whether the visitor asked for less motion. False on the server and when the query can't be read. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * `rest`: the server's HTML and anything already in front of the visitor at load (shown finished, nothing moves);
 * `waiting`: below the fold, waiting to be scrolled to; `play`: scrolled to, the arrival runs once;
 * `reduced`: prefers-reduced-motion, so it never runs.
 */
export type ArrivalPhase = 'rest' | 'waiting' | 'play' | 'reduced';

/**
 * The page's one orchestrated arrival (DESIGN.md › Motion): it runs once, when its element is scrolled into view.
 * `armBelow` (0–1): only wait for the arrival when the element starts lower than that share of the viewport. An
 * element the visitor can already see rests in its finished state, so nothing they are looking at resets.
 */
export function useArrival<T extends Element>(threshold = 0.4, armBelow = 0) {
  const ref = useRef<T>(null);
  const [phase, setPhase] = useState<ArrivalPhase>('rest');
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (prefersReducedMotion()) {
      setPhase('reduced');
      return;
    }
    if (armBelow > 0 && element.getBoundingClientRect().top < window.innerHeight * armBelow) return;
    if (typeof IntersectionObserver === 'undefined') return;
    setPhase('waiting');
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setPhase('play');
        observer.disconnect();
      },
      { threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold, armBelow]);
  return [ref, phase] as const;
}
