// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The theme switch you make (DESIGN.md, "Theme engine"): the whole window
// changes at once inside a view transition, so the page is one picture
// throughout and nothing shows a mix of the two themes. Flipping light and
// dark with a control plays the day/night scene (theme-scene.ts): nightfall
// washes dusk down the window, daybreak washes light up it. A switch with no
// control behind it (⌘K, the app menu) or to "Match the Mac" crossfades;
// reduced motion is a 150 ms crossfade. Changes that come from elsewhere (the
// Mac's appearance, another window) are applied without one: see
// theme-engine.ts.

import { DUR, REDUCED_FADE } from '#lib/motion';
import {
  mountScene,
  SCENE_MS,
  sceneEnded,
  washKeyframes,
  washTiming,
  type Point,
  type Scene,
  type SceneKind,
} from './theme-scene';

export type { Point };

interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
}

type StartViewTransition = (update: () => Promise<void> | void) => ViewTransitionLike;

/** On <html> while a theme transition runs: "nightfall", "daybreak" or "fade". styles.css styles the snapshots by it. */
export const THEME_TRANSITION_ATTRIBUTE = 'data-theme-transition';

export interface ThemeTransitionOptions {
  /** Where the switch was made (a click, or the control's centre). */
  origin?: Point | null;
  /** Light and dark flipped by a control: the scene to play. Left out, the new theme crossfades in. */
  scene?: SceneKind | null;
}

let generation = 0;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Whether a switch made with a control here plays the scene (view transitions, and motion not reduced). */
export function scenePlays(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document && !prefersReducedMotion();
}

/** The centre of an element, for a switch made from the keyboard. */
export function centreOf(element: Element): Point {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** Where a click happened, or the control's centre when it came from the keyboard (no pointer position). */
export function originOf(event: {
  clientX: number;
  clientY: number;
  detail: number;
  currentTarget: Element;
}): Point {
  return event.detail > 0 ? { x: event.clientX, y: event.clientY } : centreOf(event.currentTarget);
}

/**
 * Runs `update` (the switch itself) as a view transition: the window as it
 * was stays on screen until `update` has finished, then the new theme comes
 * in. Without the View Transitions API it just runs `update`.
 */
export async function runThemeTransition(
  update: () => Promise<void> | void,
  options: ThemeTransitionOptions = {},
  root: HTMLElement = document.documentElement,
): Promise<void> {
  const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
  if (typeof start !== 'function') {
    await update();
    return;
  }
  const origin = options.origin ?? null;
  const kind = origin && !prefersReducedMotion() ? (options.scene ?? null) : null;
  const token = ++generation;
  root.setAttribute(THEME_TRANSITION_ATTRIBUTE, kind ?? 'fade');
  let scene: Scene | null = null;
  const transition = start.call(document, async () => {
    await update();
    // In the update, so the new picture has the bodies and the old one doesn't.
    if (kind && origin) scene = await mountScene(kind, origin);
  });
  if (kind && origin) {
    transition.ready
      .then(() => {
        root.animate(washKeyframes(kind), { ...washTiming(kind), pseudoElement: '::view-transition-new(root)' });
        scene?.play(root);
      })
      // A newer switch skipped this one: it plays its own.
      .catch(() => undefined);
  }
  void transition.finished
    .catch(() => undefined)
    .then(() => {
      scene?.remove();
      if (token !== generation) return;
      root.removeAttribute(THEME_TRANSITION_ATTRIBUTE);
      if (kind) sceneEnded(kind);
    });
  await transition.updateCallbackDone;
}

/** The longest a theme transition runs, in ms (tests and the toggle wait this out). */
export const THEME_TRANSITION_MS = Math.max(SCENE_MS, DUR.short * 1000, REDUCED_FADE * 1000);
