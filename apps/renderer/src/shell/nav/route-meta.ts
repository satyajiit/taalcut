// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';

/**
 * What a route says about its place in the app, for the window bar's way up
 * (DESIGN.md "Window", v0.4). A route file sets it in `staticData`:
 *
 *   createFileRoute('/_shell/library/')({ staticData: { crumb: msg`Library` }, … })
 *
 * A page under it (by path: /library/$assetId, /library/phone/…) then shows
 * "Library ›" before its own name, with no code of its own.
 */
declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The page's name when a page under it shows the way up to it. Without it, the page is never a crumb. */
    crumb?: MessageDescriptor;
    /** The page above this one when it isn't the path's parent: Exports (/renders) sits under Projects. */
    up?: string;
  }
}

/**
 * First run is a flow of its own. Back and Forward never step into it from
 * the app: once setup is finished or skipped, its steps are behind you.
 * apps/desktop/src/main/menu/navigation.ts applies the same rule to the menu
 * and the trackpad.
 */
export function isFirstRun(pathname: string): boolean {
  return pathname === '/onboarding' || pathname.startsWith('/onboarding/');
}

/** True when going from `here` to `there` would step into first run from the app. */
export function crossesIntoFirstRun(here: string, there: string | null): boolean {
  return there !== null && isFirstRun(there) && !isFirstRun(here);
}
