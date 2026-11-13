// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The theme switch you make with the toggle, ported from the app (packages/ui/src/theme/theme-transition.ts): the whole
 * page changes at once inside a view transition, so it is one picture throughout and nothing shows a mix of the two
 * themes. The toggle plays the day-and-night scene (theme-scene.ts). Reduced motion is a 150 ms crossfade, and a
 * browser without View Transitions switches at once.
 */
import { DUR, REDUCED_FADE } from '#lib/motion';
import { mountScene, SCENE_MS, sceneEnded, washKeyframes, WASH_TIMING, type Point, type Scene, type SceneKind } from './theme-scene';

interface ViewTransitionLike {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  readonly updateCallbackDone: Promise<void>;
}

type StartViewTransition = (update: () => Promise<void> | void) => ViewTransitionLike;

/** On <html> while a theme transition runs: "nightfall", "daybreak" or "fade". theme-scene.css styles the pictures by it. */
export const THEME_TRANSITION_ATTRIBUTE = 'data-theme-transition';

/** The longest a theme transition runs, in ms. */
export const THEME_TRANSITION_MS = Math.max(SCENE_MS, DUR.short * 1000, REDUCED_FADE * 1000);

let generation = 0;

function reduced(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Whether a switch made with the toggle plays the scene here (View Transitions, and motion not reduced). */
export function scenePlays(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document && !reduced();
}

/** Where a click happened, or the control's centre when it came from the keyboard (no pointer position). */
export function originOf(event: { clientX: number; clientY: number; detail: number; currentTarget: Element }): Point {
  if (event.detail > 0) return { x: event.clientX, y: event.clientY };
  const box = event.currentTarget.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/**
 * Runs `update` (the switch itself, which must have changed the page when it returns) as a view transition: the page
 * as it was stays on screen until then, and the new theme comes in under the scene. Without the API it just runs it.
 */
export async function runThemeTransition(
  update: () => void,
  scene: SceneKind,
  origin: Point,
  root: HTMLElement = document.documentElement,
): Promise<void> {
  const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
  if (typeof start !== 'function') {
    update();
    return;
  }
  const kind = reduced() ? null : scene;
  const token = ++generation;
  root.setAttribute(THEME_TRANSITION_ATTRIBUTE, kind ?? 'fade');
  let mountedScene: Scene | null = null;
  const transition = start.call(document, async () => {
    update();
    // In the update, so the new picture has the bodies and the old one doesn't.
    if (kind) mountedScene = await mountScene(kind, origin);
  });
  if (kind) {
    transition.ready
      .then(() => {
        root.animate(washKeyframes(kind), { ...WASH_TIMING, pseudoElement: '::view-transition-new(root)' });
        mountedScene?.play(root);
      })
      // A newer switch skipped this one: it plays its own.
      .catch(() => undefined);
  }
  void transition.finished
    .catch(() => undefined)
    .then(() => {
      mountedScene?.remove();
      if (token !== generation) return;
      root.removeAttribute(THEME_TRANSITION_ATTRIBUTE);
      if (kind) sceneEnded(kind);
    });
  await transition.updateCallbackDone.catch(() => undefined);
}
