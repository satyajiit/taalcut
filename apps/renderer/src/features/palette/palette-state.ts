// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether ⌘K is open, outside React's tree so the sidebar button, the ⌘K key
 * and the palette (a chunk that loads after the first frame) share it. A ⌘K
 * pressed before the palette has loaded opens it as soon as it arrives.
 */
import { useSyncExternalStore } from 'react';

export interface PaletteState {
  readonly open: boolean;
  /** Counts openings; the palette reloads the bus's command list on each. */
  readonly opened: number;
}

export interface PaletteStore {
  getState(): PaletteState;
  setOpen(open: boolean): void;
  toggle(): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export function createPaletteStore(): PaletteStore {
  let state: PaletteState = { open: false, opened: 0 };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    getState: () => state,
    setOpen(open) {
      if (state.open === open) return;
      state = { open, opened: state.opened + (open ? 1 : 0) };
      notify();
    },
    toggle() {
      this.setOpen(!state.open);
    },
    reset() {
      state = { open: false, opened: 0 };
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const paletteStore: PaletteStore = createPaletteStore();

export function setPaletteOpen(open: boolean): void {
  paletteStore.setOpen(open);
}

export function togglePalette(): void {
  paletteStore.toggle();
}

export function usePaletteState(store: PaletteStore = paletteStore): PaletteState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
