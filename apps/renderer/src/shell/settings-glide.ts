// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { cssEase, DUR, EASE_OUT, useReducedMotion } from '@taalcut/ui';
import { useLayoutEffect, useRef, type RefObject } from 'react';

/** The groups' slide and the hairlines' fade: the fold's own length and easing. */
const GLIDE: KeyframeAnimationOptions = { duration: DUR.short * 1000, easing: cssEase(EASE_OUT) };
/** As the rows' words come back (styles.css: --fold-in, after --fold-in-delay), so the headings arrive with them. */
const WORDS_BACK: KeyframeAnimationOptions = {
  ...GLIDE,
  duration: DUR.short * 600,
  delay: DUR.short * 300,
  fill: 'backwards',
};

/**
 * Settings' rail drops its group headings' room, so all ten sections fit the smallest window (960 × 600), and the
 * open sidebar takes it back. The room goes once the fold has settled (the rail's own layout) and comes back as the
 * sidebar starts to open, so on their own the groups would jump. Each part marked `data-glide` is read where it
 * was laid out at the last render and slid from there to its new place; a hairline the rail adds fades in; on the
 * way open, the headings fade in with the rows' words. Transform and opacity only, on the Web Animations API;
 * reduced motion, or a DOM without Web Animations (a test's), switches at once.
 */
export function useGroupsGlide(list: RefObject<HTMLElement | null>, rail: boolean): void {
  const reduce = useReducedMotion() === true;
  const tops = useRef<ReadonlyMap<string, number> | null>(null);
  const wasRail = useRef(rail);
  // After every render: what changed since the last one is what moved.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const parts = [...el.querySelectorAll<HTMLElement>('[data-glide]')];
    const before = tops.current;
    const folded = wasRail.current !== rail;
    wasRail.current = rail;
    tops.current = new Map(parts.map((part) => [part.dataset.glide ?? '', part.offsetTop]));
    if (!folded || !before || reduce) return;
    for (const part of parts) {
      if (typeof part.animate !== 'function') return;
      const was = before.get(part.dataset.glide ?? '');
      if (was === undefined) part.animate([{ opacity: 0 }, { opacity: 1 }], GLIDE);
      else if (Math.abs(was - part.offsetTop) >= 0.5)
        part.animate([{ transform: `translateY(${was - part.offsetTop}px)` }, { transform: 'none' }], GLIDE);
    }
    if (!rail)
      for (const heading of el.querySelectorAll<HTMLElement>('h2'))
        heading.animate([{ opacity: 0 }, { opacity: 1 }], WORDS_BACK);
  });
}
