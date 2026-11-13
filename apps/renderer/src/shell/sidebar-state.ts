// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether the sidebar is folded to its icon rail (View › Toggle Sidebar, ⌃⌘S or
 * Ctrl+B on a PC, ⌘K, or the button in the window bar), outside React's tree so the menu's
 * ui.action, ⌘K and the button share it. Remembered in localStorage, like the
 * theme, so the next launch opens the same way.
 *
 * A narrow window (under 1100 px) folds it to the rail by itself (DESIGN.md
 * "Window", v0.4), so the page keeps its room at the app's smallest sizes. The
 * button still opens it there, for as long as the window stays narrow; widening
 * brings back what the person chose, which a narrow window never changes.
 */
import { useLayoutEffect, useSyncExternalStore } from 'react';

export const SIDEBAR_STORAGE_KEY = 'taalcut.sidebar';

function stored(): boolean {
  try {
    const value = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    // "hidden" is what earlier builds wrote, when closing the sidebar hid it: it now folds to the rail.
    return value === 'collapsed' || value === 'hidden';
  } catch {
    return false;
  }
}

/** Narrower than this, the window folds the sidebar to its rail by itself. */
export const NARROW_WINDOW_QUERY = '(max-width: 1099.98px)';

let collapsed: boolean | null = null;
let narrow: boolean | null = null;
/** The person opened the sidebar while the window is narrow: it stays open until the window widens. */
let openWhileNarrow = false;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

function isNarrow(): boolean {
  if (narrow === null) {
    const query = typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_WINDOW_QUERY) : null;
    narrow = query?.matches ?? false;
    query?.addEventListener('change', (event) => {
      narrow = event.matches;
      openWhileNarrow = false;
      notify();
    });
  }
  return narrow;
}

function current(): boolean {
  collapsed ??= stored();
  return collapsed || (isNarrow() && !openWhileNarrow);
}

function remember(next: boolean): void {
  collapsed = next;
  try {
    if (next) window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'collapsed');
    else window.localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  } catch {
    // Storage can be off (private mode): the choice then lasts until reload.
  }
}

export function setSidebarCollapsed(next: boolean): void {
  if (current() === next) return;
  if (isNarrow()) {
    // Folding back is what a narrow window does anyway; opening it also forgets a remembered rail.
    openWhileNarrow = !next;
    if (!next) remember(false);
  } else remember(next);
  notify();
}

export function toggleSidebar(): void {
  setSidebarCollapsed(!current());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the sidebar is the icon rail. */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, current);
}

/** The sidebar's element, for the window bar's toggle (aria-controls). */
export const SIDEBAR_ID = 'app-sidebar';

// Whether a sidebar is on screen: the shell's pages and a page that isn't found have one; onboarding and a page
// that failed (rendered in the shell's place) don't. The window bar's band and toggle go with it.
let mounted = 0;

/** Called by the sidebar: it is on screen while mounted (set before paint, so the bar never lags). */
export function useSidebarMounted(): void {
  useLayoutEffect(() => {
    mounted += 1;
    notify();
    return () => {
      mounted -= 1;
      notify();
    };
  }, []);
}

/** True while a sidebar (open or folded) is on screen. */
export function useSidebarShown(): boolean {
  return useSyncExternalStore(subscribe, () => mounted > 0);
}
