// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Layout motion for the clips (DESIGN.md motion: transform only, the motion
 * tokens; a spring only for a physical drag). When the order changes, each
 * clip that moved slides from where it was to where it is now (FLIP on the
 * Web Animations API, which the compositor runs). The clip you let go of
 * settles with a critically damped spring: no bounce. Under reduced motion
 * nothing slides; the clips take their places at once.
 */
import { cssEase, DUR, EASE_OUT } from '@taalcut/ui';
import { useLayoutEffect, useRef, type RefObject } from 'react';

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A critically damped spring (stiffness 400, damping 40, mass 1) as a CSS
 * linear() easing over `ms`: it reaches its place without overshooting.
 */
export function springEasing(points = 24): string {
  const omega = Math.sqrt(400);
  const settle = 0.42;
  const values: string[] = [];
  for (let i = 0; i <= points; i += 1) {
    const t = (i / points) * settle;
    const progress = 1 - (1 + omega * t) * Math.exp(-omega * t);
    values.push(Math.min(1, progress).toFixed(4));
  }
  values[values.length - 1] = '1';
  return `linear(${values.join(', ')})`;
}
export const SPRING_MS = 420;

/** Slides `el` from `fromX` (a translateX now on it, in px) to its place. */
export function settle(el: HTMLElement, fromX: number): void {
  el.style.transform = '';
  if (reduced() || Math.abs(fromX) < 0.5) return;
  el.animate([{ transform: `translateX(${fromX}px)` }, { transform: 'translateX(0)' }], {
    duration: SPRING_MS,
    easing: springEasing(),
  });
}

/**
 * Animates children of `container` that carry `data-flip-key` from their old
 * place to their new one whenever `order` changes. `skip` names a child under
 * the pointer's control (the clip being dragged). A new `scale` (zoom) moves
 * everything at once: that is a new view, not things moving.
 */
export function useFlip(
  container: RefObject<HTMLElement | null>,
  order: string,
  scale: number,
  skip?: RefObject<string | null>,
): void {
  const last = useRef(new Map<string, number>());
  const lastScale = useRef(scale);
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const next = new Map<string, number>();
    const items = root.querySelectorAll<HTMLElement>('[data-flip-key]');
    for (const el of items) next.set(el.dataset.flipKey!, el.offsetLeft);
    const rescaled = lastScale.current !== scale;
    lastScale.current = scale;
    if (!reduced() && !rescaled) {
      for (const el of items) {
        const key = el.dataset.flipKey!;
        if (key === skip?.current) continue;
        const before = last.current.get(key);
        const after = next.get(key)!;
        if (before === undefined || Math.abs(before - after) < 0.5) continue;
        el.animate([{ transform: `translateX(${before - after}px)` }, { transform: 'translateX(0)' }], {
          duration: DUR.short * 1000,
          easing: cssEase(EASE_OUT),
        });
      }
    }
    last.current = next;
  }, [container, order, scale, skip]);
}
