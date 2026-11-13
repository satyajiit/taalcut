// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * First-visit tips (UX4): each page may offer one, by an id of its own, until it is dismissed. Dismissed tips are
 * remembered in localStorage, so a tip never comes back; another window hears of it through the storage event.
 */
import { useCallback, useSyncExternalStore } from 'react';

export const TIPS_STORAGE_KEY = 'taalcut.tips';

const NONE: ReadonlySet<string> = new Set();
let unstored: ReadonlySet<string> | null = null;
let cached: { raw: string | null; ids: ReadonlySet<string> } | null = null;
const listeners = new Set<() => void>();

/** The tips dismissed so far. */
export function dismissedTips(): ReadonlySet<string> {
  if (unstored) return unstored;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(TIPS_STORAGE_KEY);
  } catch {
    return NONE;
  }
  if (cached?.raw === raw) return cached.ids;
  let ids = NONE;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    // A damaged entry counts as none dismissed.
  }
  cached = { raw, ids };
  return ids;
}

export function dismissTip(id: string): void {
  const ids = dismissedTips();
  if (ids.has(id)) return;
  const next = new Set([...ids, id]);
  try {
    window.localStorage.setItem(TIPS_STORAGE_KEY, JSON.stringify([...next]));
    unstored = null;
  } catch {
    unstored = next;
  }
  for (const listener of listeners) listener();
}

/** Every tip shows again (Settings, the set lane's "Show tips again"). */
export function resetTips(): void {
  try {
    window.localStorage.removeItem(TIPS_STORAGE_KEY);
  } catch {
    // Nothing stored to forget.
  }
  unstored = null;
  cached = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const fromAnotherWindow = (event: StorageEvent) => {
    if (event.key === TIPS_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', fromAnotherWindow);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', fromAnotherWindow);
  };
}

/** A page's first-visit tip: whether it shows, and how to dismiss it for good. */
export function useFirstVisitTip(id: string): { shown: boolean; dismiss: () => void } {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => dismissedTips().has(id),
    () => true,
  );
  const dismiss = useCallback(() => dismissTip(id), [id]);
  return { shown: !dismissed, dismiss };
}
