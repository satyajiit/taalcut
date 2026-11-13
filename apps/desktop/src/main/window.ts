// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { BrowserWindow, Menu } from 'electron';
import type { WindowChrome } from '../platform/types';
import { historyMenu } from './menu/navigation';
import { type Runtime } from './runtime';
import { secureWebPreferences } from './security/web-preferences';
import { windowBackground, windowChromeColours } from './theme';

/** The main window's own options, before the platform's frame (platform/frame.ts) is merged in. */
export function mainWindowOptions(chrome: WindowChrome, colours: Parameters<WindowChrome['options']>[0]) {
  return {
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Taalcut',
    ...chrome.options(colours),
  };
}

/**
 * The main window. Hidden until its first frame is ready, and painted in the
 * theme's canvas colour meanwhile, so launch never flashes (DESIGN.md).
 *
 * The renderer draws the window bar: the mark, the page's name and, on a Mac,
 * the app's own traffic controls (appContract.window). The frame is the
 * platform's (platform/frame.ts): on macOS the title bar is hidden and the
 * system lights too, the frame kept; on Linux the title bar is hidden and the
 * system's controls are overlaid on the bar's right end. Never `frame: false`,
 * which loses the native resize edges and the full-screen Space.
 */
export function createMainWindow(runtime: Runtime, preload: string, chrome: WindowChrome): BrowserWindow {
  const win = new BrowserWindow({
    ...mainWindowOptions(chrome, windowChromeColours()),
    backgroundColor: windowBackground(),
    webPreferences: secureWebPreferences({ preload, devTools: runtime.devTools }),
  });
  chrome.attach(win);
  // Back and Forward by swipe and mouse button, and the View menu's Back and Forward kept right (menu/navigation.ts).
  historyMenu.watch(win, () => Menu.getApplicationMenu());
  win.once('ready-to-show', () => win.show());
  void win.loadURL(runtime.startUrl);
  return win;
}
