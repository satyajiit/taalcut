// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A BrowserWindow as core's WindowService (appContract.window): what the
 * renderer's window bar and traffic controls ask of their own window. The
 * system traffic lights are hidden (window.ts), so these are the only
 * controls; the native menu's Close Window, Minimize, Zoom and Toggle Full
 * Screen keep working beside them. Electron-free, so unit-tested.
 */
import { doubleClickAction, type WindowService, type WindowState } from '@taalcut/core';

/** Window events that can change what the bar shows. */
export const WINDOW_EVENTS = [
  'focus',
  'blur',
  'maximize',
  'unmaximize',
  'minimize',
  'restore',
  'enter-full-screen',
  'leave-full-screen',
  'resized',
] as const;
export type WindowEvent = (typeof WINDOW_EVENTS)[number];

/** The parts of a BrowserWindow the controls use. */
export interface ControlledWindow {
  isDestroyed(): boolean;
  isFocused(): boolean;
  isMaximized(): boolean;
  isMinimized(): boolean;
  isFullScreen(): boolean;
  isDocumentEdited(): boolean;
  setDocumentEdited(edited: boolean): void;
  close(): void;
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  setFullScreen(flag: boolean): void;
  on(event: WindowEvent, listener: () => void): unknown;
  removeListener(event: WindowEvent, listener: () => void): unknown;
}

/**
 * `readDoubleClick` returns macOS's AppleActionOnDoubleClick ("Maximize",
 * "Minimize", "None", or null when unset). It is read with every state, so a
 * change in System Settings shows the next time the window changes, such as
 * when it is focused again. `allWindows` lists the app's windows, for
 * Option-click on close or minimise.
 */
export function createWindowService(
  win: ControlledWindow,
  readDoubleClick: () => string | null,
  allWindows: () => readonly ControlledWindow[] = () => [win],
): WindowService {
  const each = (all: boolean | undefined, act: (target: ControlledWindow) => void): void => {
    for (const target of all ? allWindows() : [win]) if (!target.isDestroyed()) act(target);
  };
  // No window event says "document edited", so the service tells its own listeners.
  const editedListeners = new Set<() => void>();
  // Focus as the window's focus and blur events report it (the key window), from its state now.
  let focused = win.isFocused();
  win.on('focus', () => void (focused = true));
  win.on('blur', () => void (focused = false));
  const state = (): WindowState => ({
    focused,
    maximized: win.isMaximized(),
    minimized: win.isMinimized(),
    fullScreen: win.isFullScreen(),
    edited: win.isDocumentEdited(),
    doubleClick: doubleClickAction(readDoubleClick()),
  });
  return {
    state,
    subscribe(listener) {
      let last = JSON.stringify(state());
      // One event can come with others (a restore also focuses); send each distinct state once.
      const notify = (): void => {
        if (win.isDestroyed()) return;
        const next = state();
        const key = JSON.stringify(next);
        if (key === last) return;
        last = key;
        listener(next);
      };
      for (const event of WINDOW_EVENTS) win.on(event, notify);
      editedListeners.add(notify);
      return () => {
        editedListeners.delete(notify);
        if (win.isDestroyed()) return;
        for (const event of WINDOW_EVENTS) win.removeListener(event, notify);
      };
    },
    close: (options) => each(options?.allWindows, (target) => target.close()),
    minimize: (options) => each(options?.allWindows, (target) => target.minimize()),
    setEdited(edited) {
      if (win.isDestroyed()) return;
      win.setDocumentEdited(edited);
      for (const listener of editedListeners) listener();
    },
    // macOS zoom toggles between the user's size and filling the screen.
    zoom: () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
    toggleFullScreen: () => win.setFullScreen(!win.isFullScreen()),
  };
}
