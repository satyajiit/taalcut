// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Taalcut theme engine (renderer side). DESIGN.md, "Theme engine".
//
// One preference: "system" | "light" | "dark". The engine resolves it against
// the OS, writes it to <html>, and tells subscribers. Colours themselves live
// in CSS (design/tokens/tailwind.css), so a switch is one attribute change:
//
//   preference "system" → no data-theme; CSS follows prefers-color-scheme
//   preference "light"  → data-theme="light"
//   preference "dark"   → data-theme="dark"
//
// In Electron the main process also sets nativeTheme.themeSource, so
// prefers-color-scheme, native menus, scrollbars and dialogs all agree, and the
// first paint is already in the right theme (no flash). In a browser,
// web-boot.js applies the stored choice before first paint.

import type { ResolvedTheme, ThemePreference, ThemeState } from '@taalcut/core';
import type { ThemeBridge } from './bridge';
import { isThemePreference, THEME_STORAGE_KEY } from './preferences';
import { createSaveQueue } from './save-queue';
import { runThemeTransition, type Point } from './theme-transition';

/** Where the preference lives. Electron: the main process. Browser: localStorage. */
export interface ThemeStore {
  load(): ThemePreference | Promise<ThemePreference>;
  /** Rejects when the preference wasn't kept (the engine then shows the one that was). */
  save(preference: ThemePreference): void | Promise<void>;
  /** Changes made elsewhere: another window, the app menu, another tab. */
  subscribe?(listener: (preference: ThemePreference) => void): () => void;
  /**
   * Saving "system" changes what prefers-color-scheme says (Electron's
   * nativeTheme.themeSource), a moment after save() resolves.
   */
  movesSystemAppearance?: boolean;
}

export interface SetPreferenceOptions {
  /**
   * Where the switch was made (a click, or the control's centre). Flipping
   * light and dark from there plays the day/night scene (theme-scene.ts).
   * Left out, or to "system", it crossfades.
   */
  from?: Point;
  /** Switch at once, with no transition (tests, scripted changes). */
  instant?: boolean;
}

export interface ThemeEngine {
  init(): Promise<void>;
  getState(): ThemeState;
  /** A switch you made: shown as a view transition (theme-transition.ts) unless `instant`. */
  setPreference(preference: ThemePreference, options?: SetPreferenceOptions): Promise<void>;
  /** Flips between light and dark from whatever is showing now. */
  toggle(options?: SetPreferenceOptions): Promise<void>;
  subscribe(listener: (state: ThemeState) => void): () => void;
  destroy(): void;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function createThemeEngine(options: { store: ThemeStore; root?: HTMLElement }): ThemeEngine {
  const { store } = options;
  const root = options.root ?? document.documentElement;
  const media = window.matchMedia(DARK_QUERY);
  const listeners = new Set<(state: ThemeState) => void>();
  let preference: ThemePreference = 'system';
  let snapshot: ThemeState = compute();
  let unsubscribeStore: (() => void) | undefined;
  const saves = createSaveQueue(store, {
    // A failed save with no newer choice waiting, or news from the store while ours ran: show what it keeps.
    restore: (kept) => {
      if (kept === preference) return;
      preference = kept;
      apply();
    },
  });

  function compute(): ThemeState {
    const resolved: ResolvedTheme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    return { preference, resolved };
  }

  function emit(): void {
    const next = compute();
    if (next.preference === snapshot.preference && next.resolved === snapshot.resolved) return;
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  }

  function apply(): void {
    suppressTransitions(root);
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);
    root.setAttribute('data-theme-preference', preference);
    emit();
  }

  function onSystemChange(): void {
    if (preference !== 'system') return;
    suppressTransitions(root);
    emit();
  }

  async function setPreference(next: ThemePreference, options: SetPreferenceOptions = {}): Promise<void> {
    if (!isThemePreference(next)) throw new TypeError(`Unknown theme preference: ${String(next)}`);
    if (next === preference) return;
    let saved: Promise<void> = Promise.resolve();
    const switchTo = async () => {
      preference = next;
      apply();
      // One save at a time; a choice made meanwhile replaces any still waiting (IX3-F7, F2).
      saved = saves.save(next);
      // Electron: "system" follows the Mac only once main has told nativeTheme; wait for it, so the
      // new picture is the right theme, not the old one for a frame. Light and dark are on the page
      // already (data-theme decides every colour and color-scheme), so the window doesn't hold its
      // old picture while main switches the app's appearance and saves the choice (IX3-F2).
      if (next === 'system' && store.movesSystemAppearance) {
        await saved;
        await mediaSettled(media, 120);
      }
    };
    if (options.instant) await switchTo();
    else
      await runThemeTransition(
        switchTo,
        { origin: options.from ?? null, scene: sceneFor(next, snapshot) },
        root,
      );
    // The switch ends with the store's answer either way; a failed save has put back the kept theme.
    await saved;
  }

  return {
    async init() {
      const loaded = await store.load();
      preference = isThemePreference(loaded) ? loaded : 'system';
      saves.loaded(preference);
      apply();
      media.addEventListener('change', onSystemChange);
      unsubscribeStore = store.subscribe?.((next) => {
        // While our saves run, the queue asks the store once they are done (IX3-F7, F2).
        if (!isThemePreference(next) || !saves.elsewhere(next) || next === preference) return;
        const switchTo = async () => {
          preference = next;
          apply();
          if (next === 'system' && store.movesSystemAppearance) await mediaSettled(media, 120);
        };
        // Made in this window (⌘K over the command bus, the app menu): a crossfade. Another
        // window or tab: at once, as it isn't the one you are looking at.
        if (document.hasFocus() && document.visibilityState === 'visible') {
          void runThemeTransition(switchTo, {}, root);
        } else void switchTo();
      });
    },
    getState: () => snapshot,
    setPreference,
    toggle: (options) => setPreference(snapshot.resolved === 'dark' ? 'light' : 'dark', options),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      media.removeEventListener('change', onSystemChange);
      unsubscribeStore?.();
      listeners.clear();
    },
  };
}

// Colours flip in one frame instead of animating through every transition.
function suppressTransitions(root: HTMLElement): void {
  root.setAttribute('data-theme-switching', '');
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-theme-switching')));
}

/** Resolves on prefers-color-scheme's next change, or after `ms` when it has none to make. */
function mediaSettled(media: MediaQueryList, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      media.removeEventListener('change', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    media.addEventListener('change', done);
  });
}

/** Dusk or daylight only when you flip what you see; "system" may not change it, so it crossfades. */
function sceneFor(next: ThemePreference, showing: ThemeState): 'nightfall' | 'daybreak' | null {
  if (next === 'system' || next === showing.resolved) return null;
  return next === 'dark' ? 'nightfall' : 'daybreak';
}

/** Electron: the main process owns the preference and syncs nativeTheme. */
export function electronStore(bridge: ThemeBridge): ThemeStore {
  return {
    load: () => bridge.get(),
    save: (preference) => bridge.set(preference),
    subscribe: (listener) => bridge.onChange(listener),
    movesSystemAppearance: true,
  };
}

/** Browser builds and web pages. Storage can be blocked, so every access is guarded. */
export function localStorageStore(key = THEME_STORAGE_KEY): ThemeStore {
  return {
    load() {
      try {
        const value = window.localStorage.getItem(key);
        return isThemePreference(value) ? value : 'system';
      } catch {
        return 'system';
      }
    },
    save(preference) {
      try {
        window.localStorage.setItem(key, preference);
      } catch {
        // Private window or blocked storage: the choice lasts for this page only.
      }
    },
    subscribe(listener) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key && isThemePreference(event.newValue)) listener(event.newValue);
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
  };
}

/** Main's theme when the renderer has a connection to it (Electron), otherwise localStorage. */
export function defaultThemeStore(bridge?: ThemeBridge | null): ThemeStore {
  return bridge ? electronStore(bridge) : localStorageStore();
}
