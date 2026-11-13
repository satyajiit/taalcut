// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n, MessageDescriptor } from '@lingui/core';
import type { AnyRouter } from '@tanstack/react-router';
import { crumbKey, type CrumbWords } from './crumb-words';

/**
 * One step up from the page on screen, and its URL: a page that says it is a crumb (`staticData.crumb`), or one an
 * open page has named (crumb-words.ts). Its name is `words` when it has them, else `label`; it always has one.
 */
export type Crumb = { readonly to: string } & (
  | { readonly label: MessageDescriptor; readonly words?: CrumbWords }
  | { readonly label?: undefined; readonly words: CrumbWords }
);

/** What a crumb reads: the name a page gave it, else its route's words. */
export function crumbText(i18n: I18n, crumb: Crumb): string {
  return crumb.label === undefined ? crumb.words.text : (crumb.words?.text ?? i18n._(crumb.label));
}

/** The names pages give their crumbs, by path (crumb-words.ts); none by default. */
export type CrumbNames = ReadonlyMap<string, CrumbWords>;
const NO_NAMES: CrumbNames = new Map();

/** A crumb at `to` from its route's words and the name a page gave it, if either; else none. */
function crumbAt(to: string, label: MessageDescriptor | undefined, names: CrumbNames): Crumb | null {
  const words = names.get(crumbKey(to));
  if (label) return words ? { to, label, words } : { to, label };
  return words ? { to, words } : null;
}

/** '/templates/hub/01K…' → '/templates/hub', '/library' → '/', '/' → null. */
export function parentPath(pathname: string): string | null {
  const trimmed = pathname.replace(/\/+$/, '');
  if (trimmed === '') return null;
  const cut = trimmed.lastIndexOf('/');
  return cut <= 0 ? '/' : trimmed.slice(0, cut);
}

export type RouteMatcher = Pick<AnyRouter, 'getMatchedRoutes'>;

/** The route that is exactly this path: not one that only matches its start. */
function routeAt(router: RouteMatcher, pathname: string) {
  const [, params, route] = router.getMatchedRoutes(pathname);
  return route && params['**'] === undefined ? route : undefined;
}

/**
 * The page's own crumb, when its route is one: a filtered view of it ("Make › Archived") leads back to the page
 * itself, unfiltered.
 */
export function ownCrumb(router: RouteMatcher, pathname: string, names: CrumbNames = NO_NAMES): Crumb | null {
  return crumbAt(pathname, routeAt(router, pathname)?.options.staticData?.crumb, names);
}

/** Deep enough for any page the app has; it also stops a pair of `up`s that point at each other. */
const MAX_DEPTH = 8;

/**
 * The way up from a page, outermost first: each page above it by path (or by
 * a route's `up`) that has a crumb, or that an open page has named (`names`).
 * Pages that aren't crumbs are passed over, so /projects/$id/timeline goes
 * straight to Projects. Generic: a new route under one with a crumb gets its
 * way up without code of its own.
 */
export function crumbTrail(router: RouteMatcher, pathname: string, names: CrumbNames = NO_NAMES): Crumb[] {
  const trail: Crumb[] = [];
  let path = pathname;
  let up = routeAt(router, path)?.options.staticData?.up;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const next = up ?? parentPath(path);
    if (next === null || next === path) break;
    const route = routeAt(router, next);
    const crumb = crumbAt(next, route?.options.staticData?.crumb, names);
    if (crumb) trail.unshift(crumb);
    path = next;
    up = route?.options.staticData?.up;
  }
  return trail;
}
