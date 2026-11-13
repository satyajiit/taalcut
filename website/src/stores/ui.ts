// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { create } from 'zustand';

/** Chrome state: the phone menu, and whether the logo has counted in this session (it does once). */
export interface UiState {
  readonly menuOpen: boolean;
  readonly countedIn: boolean;
  setMenuOpen(open: boolean): void;
  markCountedIn(): void;
}

const COUNT_IN_KEY = 'taalcut.countedIn';

function readCountedIn(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(COUNT_IN_KEY) === '1';
  } catch {
    return false;
  }
}

export const useUiStore = create<UiState>()((set) => ({
  menuOpen: false,
  countedIn: readCountedIn(),
  setMenuOpen(open) {
    set({ menuOpen: open });
  },
  markCountedIn() {
    try {
      window.sessionStorage.setItem(COUNT_IN_KEY, '1');
    } catch {
      // Storage can be blocked (private windows); the count-in then plays on each page load, which is harmless.
    }
    set({ countedIn: true });
  },
}));
