// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Show Kaatu (UX4): on by default. Off, the companion and every moment's and empty state's Kaatu go and their words
 * stay (packages/ui KaatuPresenceProvider, given this value in routes/__root.tsx). Kept as the interface sounds'
 * switch is (features/sounds/interface-sounds.ts): outside React, in localStorage, and a window that flips it tells
 * the others through the storage event. Settings › General's switch (the set lane) and ⌘K's command use the hook
 * and the setter here.
 */
import { useSyncExternalStore } from 'react';

export const KAATU_STORAGE_KEY = 'taalcut.kaatu';

/** When storage is off (private mode), the choice lasts until reload. */
let unstored: boolean | null = null;
const listeners = new Set<() => void>();

export function kaatuShown(): boolean {
  if (unstored !== null) return unstored;
  try {
    return window.localStorage.getItem(KAATU_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setShowKaatu(on: boolean): void {
  if (kaatuShown() === on) return;
  try {
    if (on) window.localStorage.removeItem(KAATU_STORAGE_KEY);
    else window.localStorage.setItem(KAATU_STORAGE_KEY, 'off');
    unstored = null;
  } catch {
    unstored = on;
  }
  for (const listener of listeners) listener();
}

export function toggleShowKaatu(): void {
  setShowKaatu(!kaatuShown());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const fromAnotherWindow = (event: StorageEvent) => {
    if (event.key === KAATU_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', fromAnotherWindow);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', fromAnotherWindow);
  };
}

/** The switch: whether Kaatu shows, and the setter. */
export function useShowKaatu(): readonly [on: boolean, set: (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, kaatuShown, () => true);
  return [on, setShowKaatu];
}
