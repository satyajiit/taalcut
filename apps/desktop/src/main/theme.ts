// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Taalcut theme engine (main process). Moved from design/theme/electron-main.ts.
//
// The main process owns the theme preference. It sets nativeTheme.themeSource
// so that prefers-color-scheme in every renderer, native menus, scrollbars and
// dialogs all follow the user's choice, and it paints each window's background
// in the resolved canvas colour so nothing flashes before the first frame.
//
// No flash on launch (DESIGN.md): setupTheme() runs after app ready and before
// the first BrowserWindow, which is created hidden with
// backgroundColor: windowBackground() and shown on ready-to-show.
//
// Renderers reach it through the theme contract (@taalcut/core themeRouter,
// served on each window's port to main). The preference is core's
// THEME_SETTING; saving goes through the bus (composition/theme-setting.ts).

import {
  unwrapRpc,
  type AsyncResult,
  type ThemePreference,
  type ThemeService,
  type ThemeState,
} from '@taalcut/core';
import { BrowserWindow, nativeTheme } from 'electron';
import type { ChromeColours, WindowChrome } from '../platform/types';
import { canvasColour, chromeColours } from './theme-preferences';

/** The canvas colour of the theme that is showing now. Use for BrowserWindow backgroundColor. */
export function windowBackground(): string {
  return canvasColour(nativeTheme.shouldUseDarkColors);
}

/** The colours of what the system draws in the frame (the controls overlay off a Mac), for the theme showing now. */
export function windowChromeColours(): ChromeColours {
  return chromeColours(nativeTheme.shouldUseDarkColors);
}

function currentState(): ThemeState {
  return {
    preference: nativeTheme.themeSource,
    resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  };
}

export interface MainTheme extends ThemeService {
  /** Shows a preference saved elsewhere (undo, ⌘K, the agent) without saving it again. */
  apply(preference: ThemePreference): void;
}

/**
 * Call once, after app ready and before the first window is created, with
 * the saved preference. `save` stores a preference a window chose; when it
 * fails it has already shown the saved one (theme-setting.ts), and `set`
 * rejects so the window shows it too (IX3-F7, F2). `chrome` recolours what the
 * system draws in each window's frame (the platform's).
 */
export function setupTheme(
  initial: ThemePreference,
  save: (preference: ThemePreference) => AsyncResult<void>,
  chrome?: WindowChrome,
): MainTheme {
  nativeTheme.themeSource = initial;
  const listeners = new Set<(state: ThemeState) => void>();
  let last = currentState();

  const notify = (): void => {
    const background = windowBackground();
    const colours = windowChromeColours();
    for (const win of BrowserWindow.getAllWindows()) {
      win.setBackgroundColor(background);
      chrome?.recolour(win, colours);
    }
    const next = currentState();
    if (next.preference === last.preference && next.resolved === last.resolved) return;
    last = next;
    for (const listener of [...listeners]) listener(next);
  };

  // Fires for OS appearance changes while on "system", and for most of ours.
  nativeTheme.on('updated', notify);

  const apply = (preference: ThemePreference): void => {
    if (nativeTheme.themeSource === preference) return;
    nativeTheme.themeSource = preference;
    // 'updated' doesn't fire when the resolved colours stay the same (system → dark on a dark Mac).
    notify();
  };

  // What the library keeps, as far as main knows: the start, every save, and every saved preference shown.
  let kept = initial;
  let asked = 0;

  return {
    get: currentState,
    apply(preference) {
      kept = preference;
      apply(preference);
    },
    async set(preference: ThemePreference) {
      const turn = ++asked;
      apply(preference);
      const saved = await save(preference);
      if (saved.ok) kept = preference;
      // A failed save with no newer choice behind it shows what is kept, also when the library couldn't be read
      // back to show it (IX3-F7 F2, IX3-F8).
      else if (turn === asked) apply(kept);
      unwrapRpc(saved);
      return currentState();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
