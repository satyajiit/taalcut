// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Crumbs that carry a thing's own name (UX4): while a page is open it can name a page on its way up, so the bar reads
 * "Agent › Golden hour trip › Review" and "Templates › Golden hour market › Slots" instead of a fixed word. A layout
 * names its own path once (the chat's, the template's), and every page under it shows the name. A route's
 * `staticData.crumb` stays its words until a page names it, and for good where none does; a path no route makes a
 * crumb becomes one while it is named.
 *
 * Outside React's tree, as current-project.ts is: the bar's title is a portal, and the page names it from its own.
 */
import { useEffect, useSyncExternalStore } from 'react';

/** A crumb's own name. `own` when they are a person's words (a chat's, a template's name), never translated. */
export interface CrumbWords {
  readonly text: string;
  readonly own: boolean;
}

const NONE: ReadonlyMap<string, CrumbWords> = new Map();
let named: ReadonlyMap<string, CrumbWords> = NONE;
const listeners = new Set<() => void>();

/** '/chat/01J/' and '/chat/01J' are one page. */
export const crumbKey = (path: string) => path.replace(/\/+$/, '') || '/';

function change(edit: (next: Map<string, CrumbWords>) => void): void {
  const next = new Map(named);
  edit(next);
  named = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The names pages have given the crumbs above them, by path. */
export function useCrumbWords(): ReadonlyMap<string, CrumbWords> {
  return useSyncExternalStore(
    subscribe,
    () => named,
    () => NONE,
  );
}

/**
 * Names the crumb at `path` while the caller is mounted. Nothing (`null`, or no text yet) leaves the route's own
 * word in place, so a name that is still loading never shows as an empty crumb.
 */
export function useNameCrumb(path: string, words: CrumbWords | null | undefined): void {
  const text = words?.text.trim() ?? '';
  const own = words?.own ?? false;
  useEffect(() => {
    if (!text) return;
    const at = crumbKey(path);
    const mine: CrumbWords = { text, own };
    change((next) => next.set(at, mine));
    // Only its own: a page that took the path over since keeps its name.
    return () =>
      change((next) => {
        if (next.get(at) === mine) next.delete(at);
      });
  }, [path, text, own]);
}
