// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { type RefObject, useEffect, useLayoutEffect } from 'react';
import { arrivalAtMount } from '#lib/arrival';
import { ARRIVE_AMOUNT, POP } from '#lib/motion';
import type { PoseEntrance } from './kaatu-poses';

/** How Kaatu arrives: as a sticker (peel and settle), or peeking in from behind its box's left or bottom edge. */
export type KaatuEntrance = 'sticker' | Exclude<PoseEntrance, 'in-place'>;

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const IN = 'cubic-bezier(0.32, 0, 0.67, 0)';
const IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';

/** Where an entrance starts, hidden: off past the clipped edge, or a small sticker turned away. */
const HIDDEN: Record<KaatuEntrance, Keyframe> = {
  sticker: { transform: `translateY(6%) scale(${POP.scale}) rotate(-${POP.turn}deg)`, opacity: 0 },
  'from-left': { transform: 'translateX(-82%)' },
  'from-below': { transform: 'translateY(92%)' },
};

/** Arriving from below the fold: from hidden to resting, with the world's one bounce. */
function arrive(kind: KaatuEntrance): { frames: Keyframe[]; ms: number } {
  if (kind === 'sticker') {
    return {
      ms: 640,
      frames: [
        { ...HIDDEN.sticker, easing: OUT },
        { opacity: 1, offset: 0.22, easing: OUT },
        { transform: 'translateY(-3%) scale(1.06) rotate(3deg)', offset: 0.58, easing: IN_OUT },
        { transform: 'none', opacity: 1 },
      ],
    };
  }
  const past = kind === 'from-left' ? 'translateX(5%)' : 'translateY(-5%)';
  return { ms: 760, frames: [{ ...HIDDEN[kind], easing: OUT }, { transform: past, offset: 0.62, easing: IN_OUT }, { transform: 'none' }] };
}

/**
 * Already on screen at load, so nothing hides: a sticker lifts at a corner and presses back down, and a peek ducks
 * back behind its edge and peeks out again.
 */
function again(kind: KaatuEntrance): { frames: Keyframe[]; ms: number } {
  if (kind === 'sticker') {
    return {
      ms: 720,
      frames: [
        { transform: 'none', easing: OUT },
        { transform: 'translateY(-3%) scale(1.07) rotate(-5deg)', offset: 0.35, easing: IN_OUT },
        { transform: 'scale(0.99) rotate(1.5deg)', offset: 0.7, easing: OUT },
        { transform: 'none' },
      ],
    };
  }
  const past = kind === 'from-left' ? 'translateX(5%)' : 'translateY(-5%)';
  return {
    ms: 1500,
    frames: [
      { transform: 'none', easing: IN },
      { ...HIDDEN[kind], offset: 0.2 },
      { ...HIDDEN[kind], offset: 0.42, easing: OUT },
      { transform: past, offset: 0.8, easing: IN_OUT },
      { transform: 'none' },
    ],
  };
}

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** After load, a Kaatu already on screen waits this long before its "again" entrance, so it reads as a gesture. */
const AGAIN_AFTER_MS = 450;

/**
 * Plays Kaatu's entrance once, on `target` (an element inside the clipping wrapper). Decided at mount, like
 * useArrival: the server HTML and a Kaatu already on screen are never hidden; one still below the fold is set to its
 * hidden start before the first paint and arrives when a third of it is on screen. Under reduced motion: nothing.
 */
export function useKaatuEntrance(target: RefObject<HTMLElement | null>, kind: KaatuEntrance | null): void {
  useBrowserLayoutEffect(() => {
    const el = target.current;
    if (!kind || !el || typeof el.animate !== 'function') return undefined;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canObserve = typeof IntersectionObserver !== 'undefined';
    // Measure and watch the untransformed box around it, never the moving element itself.
    const box = el.parentElement ?? el;
    const start = arrivalAtMount({ reduce, top: box.getBoundingClientRect().top, viewportHeight: window.innerHeight, canObserve });
    if (reduce) return undefined;
    if (start === 'shown') {
      const timer = window.setTimeout(() => {
        const { frames, ms } = again(kind);
        el.animate(frames, { duration: ms, easing: 'linear' });
      }, AGAIN_AFTER_MS);
      return () => window.clearTimeout(timer);
    }
    // Below the fold: hold the hidden start (fill) until it arrives.
    const hold = el.animate([HIDDEN[kind], HIDDEN[kind]], { duration: 1, fill: 'forwards' });
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        const { frames, ms } = arrive(kind);
        const play = el.animate(frames, { duration: ms, easing: 'linear' });
        play.onfinish = () => hold.cancel();
        play.oncancel = () => hold.cancel();
      },
      { threshold: ARRIVE_AMOUNT },
    );
    observer.observe(box);
    return () => {
      observer.disconnect();
      hold.cancel();
    };
  }, [kind]);
}
