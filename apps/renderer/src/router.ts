// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { pageTurnSupported, pageTurnTypes } from './shell/nav/page-turn';
import { PageError } from './shell-states/page-error';
import { PagePending } from './shell-states/shell-skeleton';

/**
 * How long a page's code may take before its bones show (UX1 W2-1). Shorter than a wait anyone notices, so a
 * page whose code is already here (or arrives within a frame or two) swaps in with no skeleton in between; on a
 * busy Mac the bones are up well inside 100 ms (PRD R32, skeleton.spec.ts).
 */
export const PENDING_MS = 40;
/** Once shown, the bones stay this long, so they never flicker on and off for a page that was nearly ready. */
export const PENDING_MIN_MS = 150;

/**
 * Browser history by default; tests pass a memory history. Every page has its own error boundary and its own
 * pending view: a page that fails, or whose code is on its way, takes only the page's place, so the window bar,
 * the sidebar and ⌘K stay. Both components live in the entry bundle, so they show even when a chunk can't.
 */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultPendingComponent: PagePending,
    defaultPendingMs: PENDING_MS,
    defaultPendingMinMs: PENDING_MIN_MS,
    defaultErrorComponent: PageError,
    // The page turn (shell/nav/page-turn.ts, app.css): the page's region crossfades with a short rise; the bar and
    // the sidebar stay. A View Transition of its own type, so it never touches the clip's frame or the theme's
    // scene. The bones keep their timing: the turn starts once the page (or its bones) is ready to show.
    defaultViewTransition: pageTurnSupported() ? { types: (change) => pageTurnTypes(change) } : false,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
