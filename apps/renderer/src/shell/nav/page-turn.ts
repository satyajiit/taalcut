// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The page turn (UX4, DESIGN.md "Motion in the shell"): going to another page crossfades the page's region with a
 * short rise, while the window bar and the sidebar stay still. A View Transition of the type `page`, started by the
 * router (router.ts) and drawn by app.css: the region is named only while one runs, so the theme's scene and the
 * clip's shared frame, which run their own, never see it.
 *
 * No turn when it would get in the way:
 * - the first page, and a change of search or hash on the same page (typing in a search field);
 * - a view picked from the page's own views row: its thumb glides, and the page under it changes at once;
 * - while another transition runs (the clip's frame opening or closing, the theme's scene): starting one now would
 *   cut it short;
 * - into or out of first run, which has its own frame;
 * - a hidden window.
 */

/** The transition type app.css styles. */
export const PAGE_TURN = 'page';

/**
 * A page's views row: Page's `views`, and every ViewLinks row. The kit's ViewLinks always carries `data-view-links`,
 * whatever its `data-slot` (make-views, templates-views, phone-tabs), and so do the rails that swap a list like a
 * view (Templates' folders, Saved's collections).
 */
const VIEW_ROWS = '[data-slot=page-views], [data-view-links]';

/** How long after a press in a views row the navigation it starts counts as a view change. */
const VIEW_PRESS_MS = 1000;
let viewPressAt = Number.NEGATIVE_INFINITY;

/** Notes presses in a page's views row (Page's `views`, and the rows that predate it), as they happen. */
export function watchViewPresses(target: Document = document): () => void {
  const note = (event: Event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest(VIEW_ROWS)) viewPressAt = performance.now();
  };
  target.addEventListener('click', note, true);
  return () => target.removeEventListener('click', note, true);
}

interface Change {
  fromLocation?: { pathname: string } | undefined;
  toLocation: { pathname: string };
  pathChanged: boolean;
}

/** Whether another view transition is running: the clip's frame, the theme's scene. */
function transitionRunning(root: HTMLElement): boolean {
  if (root.hasAttribute('data-clip-moving') || root.hasAttribute('data-theme-transition')) return true;
  const active = (document as Document & { activeViewTransition?: unknown }).activeViewTransition;
  return active !== undefined && active !== null;
}

const firstRun = (pathname: string) => pathname === '/onboarding' || pathname.startsWith('/onboarding/');

/** The router's `defaultViewTransition.types`: the page turn, or none (`false`). */
export function pageTurnTypes(
  change: Change,
  root: HTMLElement = document.documentElement,
): string[] | false {
  const from = change.fromLocation;
  if (!from || !change.pathChanged) return false;
  if (firstRun(from.pathname) || firstRun(change.toLocation.pathname)) return false;
  if (performance.now() - viewPressAt < VIEW_PRESS_MS) return false;
  if (document.hidden || transitionRunning(root)) return false;
  return [PAGE_TURN];
}

/** View Transition types are needed to scope the turn to the page's region; without them there is no turn. */
export function pageTurnSupported(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function' &&
    typeof CSS !== 'undefined' &&
    CSS.supports('selector(:active-view-transition-type(a))')
  );
}
