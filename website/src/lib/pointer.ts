// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type MotionValue, useMotionValue, useSpring } from 'motion/react';
import { type RefObject, useEffect } from 'react';
import { DRIFT } from './motion';

/** True on a mouse or a trackpad: a pointer that hovers. Touch screens get no drift. */
export function finePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/**
 * How far to lean toward a pointer at (px, py) from an element centred at (cx, cy): straight toward it, eased off
 * with distance, never past `max` px. Pure, for the test.
 */
export function driftToward(cx: number, cy: number, px: number, py: number, max: number = DRIFT.max): readonly [number, number] {
  const dx = px - cx;
  const dy = py - cy;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return [0, 0];
  // Strongest within about 240 px, fading out by about a screen away.
  const pull = max * Math.min(1, 240 / Math.max(distance, 240)) * Math.min(1, distance / 60);
  return [(dx / distance) * pull, (dy / distance) * pull];
}

/**
 * x and y springs that lean an element a few px toward the pointer, for stickers and small marks. Off (always 0) on
 * touch screens, under reduced motion and when `enabled` is false; the listener is passive and frame-throttled.
 */
export function usePointerDrift(
  ref: RefObject<Element | null>,
  { enabled = true, max = DRIFT.max }: { readonly enabled?: boolean; readonly max?: number } = {},
): { readonly x: MotionValue<number>; readonly y: MotionValue<number> } {
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, DRIFT.spring);
  const y = useSpring(rawY, DRIFT.spring);

  useEffect(() => {
    if (!enabled || !finePointer()) return undefined;
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      const el = ref.current;
      if (!el || !last) return;
      const box = el.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) return;
      const [dx, dy] = driftToward(box.left + box.width / 2, box.top + box.height / 2, last.clientX, last.clientY, max);
      rawX.set(dx);
      rawY.set(dy);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      last = event;
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    const onLeave = () => {
      rawX.set(0);
      rawY.set(0);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      if (frame) window.cancelAnimationFrame(frame);
      rawX.set(0);
      rawY.set(0);
    };
  }, [enabled, max, ref, rawX, rawY]);

  return { x, y };
}
