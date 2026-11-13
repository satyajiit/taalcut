// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type RefObject, useEffect, useLayoutEffect, useState } from 'react';
import { ARRIVE_AMOUNT } from './motion';

/** A layout effect in the browser, nothing on the server (React's own no-op there). */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * 'shown' is the finished state, 'hidden' the state an arrival starts from. Variants named this way drive a
 * motion/react `animate`: `<motion.div initial={false} animate={useArrival(ref)} variants={…}>`.
 */
export type ArrivalState = 'shown' | 'hidden';

/** The decision useArrival makes at mount, pure so it can be tested: hide only what the visitor can't see yet. */
export function arrivalAtMount(input: {
  readonly reduce: boolean;
  readonly top: number;
  readonly viewportHeight: number;
  readonly canObserve: boolean;
}): ArrivalState {
  if (input.reduce || !input.canObserve) return 'shown';
  return input.top >= input.viewportHeight ? 'hidden' : 'shown';
}

/**
 * How much of an element must be on screen for it to arrive: `amount` of it, or, for an element so tall that `amount`
 * of it can't fit on screen (or would leave it blank there too long), once it fills `amount` of the screen. Pure, for
 * the tests.
 */
export function arrivalThreshold(input: { readonly amount: number; readonly height: number; readonly viewportHeight: number }): number {
  if (input.height <= 0 || input.viewportHeight <= 0) return input.amount;
  return Math.min(input.amount, (input.amount * input.viewportHeight) / input.height);
}

/**
 * Whether an element has arrived. The server HTML and the first render are always 'shown', so the words are there
 * without JavaScript and never start at opacity 0. In the browser, before the first paint, an element still below
 * the fold is set 'hidden' (out of sight, so nothing flashes) and becomes 'shown' once `amount` of it is on screen (a
 * tall element: once it fills `amount` of the screen; arrivalThreshold). Already on screen at load, or under reduced
 * motion, it stays 'shown': the finished state.
 */
export function useArrival(
  ref: RefObject<Element | null>,
  { reduce = false, amount = ARRIVE_AMOUNT }: { readonly reduce?: boolean; readonly amount?: number } = {},
): ArrivalState {
  const [state, setState] = useState<ArrivalState>('shown');

  useBrowserLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const canObserve = typeof IntersectionObserver !== 'undefined';
    // Read the preference here, not from the hook's argument: during hydration that is still the server's false.
    const reduceNow = reduce || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const box = el.getBoundingClientRect();
    const start = arrivalAtMount({ reduce: reduceNow, top: box.top, viewportHeight: window.innerHeight, canObserve });
    if (start === 'shown') return undefined;
    setState('hidden');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState('shown');
          observer.disconnect();
        }
      },
      { threshold: arrivalThreshold({ amount, height: box.height, viewportHeight: window.innerHeight }) },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // Decided once, at mount: a later change of preference shows the finished state through the return below.
  }, []);

  return reduce ? 'shown' : state;
}
