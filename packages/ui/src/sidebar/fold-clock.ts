// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One clock for the sidebar's fold, so the parts that move with it (the
 * sidebar's edge and words, the page beside it, the window bar's band, the
 * sidebar button and the title) start in the same frame, take the same time
 * and ease the same way, though each is drawn by a different component.
 *
 * Progress runs from 0 (open) to 1 (on the rail). Every part is laid out in
 * its final place at once (one reflow) and animated from where the fold was
 * to there on the Web Animations API: transform and opacity only, so the
 * compositor runs it and no JavaScript runs per frame. Every part starts one
 * frame in (FOLD_LEAD), so the first frame drawn after the click has already
 * moved. A fold that starts while another runs starts from where that one had
 * got to on screen, so it can turn round mid-way. Under reduced motion a fold
 * takes no time.
 */
import { bezierAt, cssEase, EASE_OUT, FOLD_MS } from '#lib/motion';

export interface Fold {
  /** Progress the fold starts from (0 open, 1 rail). */
  readonly from: number;
  /** Progress it ends at. */
  readonly to: 0 | 1;
  /** performance.now() when it started. */
  readonly start: number;
  /** ms; 0 under reduced motion or when there is nothing to move. */
  readonly duration: number;
}

/**
 * ms each part starts into its fold: a frame at 120 Hz. The first frame that
 * draws the new layout is a frame's movement in, not the old picture again.
 */
export const FOLD_LEAD = 8;

let current: Fold | null = null;
// One part's animation (the sidebar's), the clock's reading of where the fold is on screen.
let shown: Animation | null = null;
const listeners = new Set<(fold: Fold) => void>();

function reduced(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Where the fold is now, 0 (open) to 1 (rail). */
export function foldProgress(fold: Fold | null = current, now = performance.now()): number {
  if (!fold) return 0;
  if (fold.duration <= 0) return fold.to;
  const eased =
    fold === current && shown ? shownProgress(shown) : bezierAt(EASE_OUT, (now - fold.start) / fold.duration);
  return fold.from + (fold.to - fold.from) * eased;
}

/** How far through its easing an animation is as last drawn (1 once it has finished). */
function shownProgress(animation: Animation): number {
  if (animation.playState === 'finished' || animation.playState === 'idle') return 1;
  return animation.effect?.getComputedTiming().progress ?? 0;
}

/** Marks `animation` as the one that shows where the current fold is (read when a fold turns round). */
export function showsFold(fold: Fold, animation: Animation): void {
  if (fold === current) shown = animation;
}

/** The sidebar's state at mount: no fold, just where it is. */
export function settleFold(collapsed: boolean): void {
  const at = collapsed ? 1 : 0;
  if (current && current.to === at) return;
  current = { from: at, to: at, start: 0, duration: 0 };
  shown = null;
}

/**
 * Folds to `collapsed` (the rail) or opens. Called by every part as it
 * commits the change; the first call starts the fold and tells the others,
 * later calls for the same target get the same fold.
 */
export function foldTo(collapsed: boolean): Fold {
  const to = collapsed ? 1 : 0;
  if (current?.to === to) return current;
  const now = performance.now();
  const from = foldProgress(current, now);
  const duration = reduced() ? 0 : FOLD_MS * Math.abs(to - from);
  current = { from, to, start: now - Math.min(FOLD_LEAD, duration), duration };
  shown = null;
  for (const listener of listeners) listener(current);
  return current;
}

/** The fold now running or last run. */
export function currentFold(): Fold | null {
  return current;
}

/** Calls `listener` when a fold starts (in the frame the sidebar's change is committed). */
export function onFold(listener: (fold: Fold) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Options for an element's part of the fold on the Web Animations API. */
export function foldTiming(fold: Fold): KeyframeAnimationOptions {
  // Every part's last frame is where the page now lays it out, so nothing needs holding at the end.
  // Started together, the parts start in the same frame, each a lead in.
  return { duration: fold.duration, delay: -Math.min(FOLD_LEAD, fold.duration), easing: cssEase(EASE_OUT) };
}

// Each element's part of the fold, so a new fold can stop it without asking the element for its
// animations (getAnimations() brings the page's style up to date: a long chat's worth).
const playing = new WeakMap<Element, Animation>();

/** Stops `el`'s part of the fold, if it is moving: it jumps to where the page lays it out. */
export function stopFold(el: Element): void {
  playing.get(el)?.cancel();
  playing.delete(el);
}

/** Plays `el`'s part of `fold` (stopping the part it was playing), unless the fold takes no time. */
export function playFold(el: Element, keyframes: Keyframe[], fold: Fold): Animation | null {
  stopFold(el);
  // No Web Animations (an old engine, a test's DOM): the part takes its place at once.
  if (fold.duration <= 0 || typeof el.animate !== 'function') return null;
  const animation = el.animate(keyframes, foldTiming(fold));
  playing.set(el, animation);
  return animation;
}
