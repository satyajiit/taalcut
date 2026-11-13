// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { RouterHistory } from '@tanstack/react-router';
import { crossesIntoFirstRun } from './route-meta';

/** How the page on screen was reached. */
export type HistoryMove = 'start' | 'push' | 'replace' | 'pop';

export interface HistorySnapshot {
  /** This entry's place in the window's history (the router's `__TSR_index`). */
  readonly index: number;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /**
   * The page one step back (its path and search), when this window has seen it: a crumb to it steps back to it
   * instead of opening it anew.
   */
  readonly previous: string | null;
  readonly move: HistoryMove;
}

export interface HistoryLedger {
  get(): HistorySnapshot;
  subscribe(listener: () => void): () => void;
  back(): void;
  forward(): void;
  /**
   * Steps back out of a part of the app (Settings): to the latest page before
   * it, when every page since is inside it. False when this window doesn't
   * know such a page (Settings opened first): the caller goes somewhere itself.
   */
  leave(inside: (path: string) => boolean): boolean;
}

/** One entry the ledger has seen: its path, its path with the search, and the router's key for it. */
interface Seen {
  readonly path: string;
  readonly href: string;
  readonly key: string;
}

interface Saved {
  readonly top: number;
  readonly seen: Readonly<Record<number, Seen>>;
}

export const LEDGER_STORAGE_KEY = 'taalcut.nav.history';
/** Entries kept either side of the current one: Back and Forward need one, the rest is slack. */
const KEEP = 50;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** sessionStorage, if the page may use it: it survives a reload, as the window's history does. */
function sessionStore(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** What an earlier load of this window kept, checked entry by entry: anything malformed is left out. */
function read(store: Store | null): Saved | null {
  let value: unknown;
  try {
    const raw = store?.getItem(LEDGER_STORAGE_KEY);
    if (!raw) return null;
    value = JSON.parse(raw);
  } catch (error) {
    console.warn('The window’s history could not be read back', error);
    return null;
  }
  if (!isRecord(value) || typeof value.top !== 'number' || !isRecord(value.seen)) return null;
  const seen: Record<number, Seen> = {};
  for (const [at, entry] of Object.entries(value.seen)) {
    if (isRecord(entry) && typeof entry.path === 'string' && typeof entry.key === 'string')
      seen[Number(at)] = {
        path: entry.path,
        href: typeof entry.href === 'string' ? entry.href : entry.path,
        key: entry.key,
      };
  }
  return { top: value.top, seen };
}

/**
 * Follows the router's history so the window bar knows whether Back and
 * Forward lead anywhere. The browser doesn't say what is ahead of you, so the
 * ledger counts it: a new page cuts everything ahead off, a step back keeps
 * it. Kept in sessionStorage, keyed by the entry's own key, so a reload
 * carries on and a different history (a test's) starts clean.
 */
export function createHistoryLedger(
  history: RouterHistory,
  store: Store | null = sessionStore(),
): HistoryLedger {
  const listeners = new Set<() => void>();
  const indexOf = () => history.location.state.__TSR_index ?? 0;
  const keyOf = () => history.location.state.__TSR_key ?? history.location.state.key ?? '';
  let seen: Record<number, Seen> = {};
  let top = indexOf();
  let move: HistoryMove = 'start';

  const saved = read(store);
  const here = saved?.seen[indexOf()];
  if (saved && here && here.key !== '' && here.key === keyOf()) {
    seen = { ...saved.seen };
    top = Math.max(saved.top, indexOf());
  }

  const snapshotOf = (): HistorySnapshot => {
    const index = indexOf();
    const path = history.location.pathname;
    const before = seen[index - 1] ?? null;
    const after = seen[index + 1]?.path ?? null;
    return {
      index,
      canGoBack: index > 0 && !crossesIntoFirstRun(path, before?.path ?? null),
      canGoForward: index < top && !crossesIntoFirstRun(path, after),
      previous: index > 0 ? (before?.href ?? null) : null,
      move,
    };
  };

  const record = () => {
    const index = indexOf();
    const { pathname, search } = history.location;
    seen[index] = { path: pathname, href: pathname + search, key: keyOf() };
    const kept: Record<number, Seen> = {};
    for (const [at, entry] of Object.entries(seen)) {
      const n = Number(at);
      if (n <= top && Math.abs(n - index) <= KEEP) kept[n] = entry;
    }
    seen = kept;
    try {
      store?.setItem(LEDGER_STORAGE_KEY, JSON.stringify({ top, seen } satisfies Saved));
    } catch (error) {
      console.warn('The window’s history could not be kept for a reload', error);
    }
  };

  record();
  let snapshot = snapshotOf();

  history.subscribe(({ action }) => {
    const index = indexOf();
    if (action.type === 'PUSH') {
      top = index;
      move = 'push';
    } else {
      top = Math.max(top, index);
      move = action.type === 'REPLACE' ? 'replace' : 'pop';
    }
    record();
    snapshot = snapshotOf();
    for (const listener of listeners) listener();
  });

  return {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    back() {
      if (snapshot.canGoBack) history.back();
    },
    forward() {
      if (snapshot.canGoForward) history.forward();
    },
    leave(inside) {
      const index = indexOf();
      const here = history.location.pathname;
      for (let at = index - 1; at >= 0; at -= 1) {
        const path = seen[at]?.path;
        if (path === undefined) return false;
        if (inside(path)) continue;
        if (crossesIntoFirstRun(here, path)) return false;
        history.go(at - index);
        return true;
      }
      return false;
    },
  };
}

const ledgers = new WeakMap<RouterHistory, HistoryLedger>();

/** The ledger of this router's history, made the first time anything asks (the window bar, at launch). */
export function ledgerFor(history: RouterHistory): HistoryLedger {
  let ledger = ledgers.get(history);
  if (!ledger) {
    ledger = createHistoryLedger(history);
    ledgers.set(history, ledger);
  }
  return ledger;
}
