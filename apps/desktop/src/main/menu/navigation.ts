// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Back and Forward outside the page (DESIGN.md "Window", v0.4). The View
 * menu's Back (⌘[) and Forward (⌘]) run the page's own steps (`nav.back`,
 * `nav.forward` as a `ui.action`, like the Go items), and they are enabled
 * only when there is a step to take. A trackpad swipe between pages, and the
 * mouse's back and forward buttons on Windows and Linux (app-command), step
 * the window's history here. On the Mac the keys and the mouse's buttons
 * reach the page first, and the page steps (apps/renderer shell/nav). Like
 * the page, the way back never steps from the app into first run
 * (/onboarding). Electron-free, so unit-tested.
 */
import type { MessageDescriptor } from '@lingui/core';
import type { UiAction } from '@taalcut/core';
import type { MenuItemConstructorOptions } from 'electron';

export const HISTORY_LABELS = {
  back: /*i18n*/ { id: 'menu.view.back', message: 'Back' },
  forward: /*i18n*/ { id: 'menu.view.forward', message: 'Forward' },
} as const satisfies Record<string, MessageDescriptor>;

export type HistoryStep = keyof typeof HISTORY_LABELS;
const STEPS: readonly HistoryStep[] = ['back', 'forward'];

/** The menu items' ids, and the actions they send: the palette's items of the same ids. */
export const HISTORY_ACTIONS: Readonly<Record<HistoryStep, string>> = {
  back: 'nav.back',
  forward: 'nav.forward',
};
/** As in Finder, Safari and System Settings; the page binds the same keys ('mod+[', 'mod+]'). */
const ACCELERATORS: Readonly<Record<HistoryStep, string>> = { back: 'CmdOrCtrl+[', forward: 'CmdOrCtrl+]' };
/** A swipe (darwin) and a mouse button (win32, linux), by what Electron names them. */
const GESTURES: ReadonlyMap<string, HistoryStep> = new Map([
  ['left', 'back'],
  ['right', 'forward'],
  ['browser-backward', 'back'],
  ['browser-forward', 'forward'],
]);

/** What is read of webContents.navigationHistory. */
export interface PageHistory {
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  getActiveIndex(): number;
  /** Null when out of range. */
  getEntryAtIndex(index: number): { readonly url: string } | null;
}

/** The parts of a BrowserWindow used here. */
export interface NavigableWindow {
  isDestroyed(): boolean;
  on(event: 'swipe' | 'app-command', listener: (event: unknown, gesture: string) => void): unknown;
  on(event: 'focus', listener: () => void): unknown;
  readonly webContents: {
    readonly navigationHistory: PageHistory;
    on(event: 'did-navigate' | 'did-navigate-in-page', listener: () => void): unknown;
  };
}

/** The app menu as shown (Menu.getApplicationMenu()): its items are found by id. */
export interface ShownMenu {
  getMenuItemById(id: string): { enabled: boolean } | null;
}

const isFirstRun = (url: string): boolean => {
  if (!URL.canParse(url)) return false;
  const path = new URL(url).pathname;
  return path === '/onboarding' || path.startsWith('/onboarding/');
};

/** Whether a step can be taken: there is a page that way, and it isn't first run seen from the app. */
export function canStep(pages: PageHistory, step: HistoryStep): boolean {
  if (!(step === 'back' ? pages.canGoBack() : pages.canGoForward())) return false;
  const index = pages.getActiveIndex();
  const here = pages.getEntryAtIndex(index);
  const there = pages.getEntryAtIndex(step === 'back' ? index - 1 : index + 1);
  return !(there && isFirstRun(there.url) && !(here && isFirstRun(here.url)));
}

export interface HistoryMenu {
  /** View's Back and Forward, enabled as the focused window's history is now. */
  items(
    text: (message: MessageDescriptor) => string,
    run: (action: UiAction) => void,
  ): MenuItemConstructorOptions[];
  /** Swipes and mouse buttons step this window; its navigation keeps the shown menu's items right. */
  watch(win: NavigableWindow, menu: () => ShownMenu | null): void;
}

export function createHistoryMenu(): HistoryMenu {
  // Read whenever the menu is built (at launch, and again in a new language), so a rebuilt menu starts right.
  const available: Record<HistoryStep, boolean> = { back: false, forward: false };
  return {
    items: (text, run) =>
      STEPS.map((step) => ({
        id: HISTORY_ACTIONS[step],
        label: text(HISTORY_LABELS[step]),
        accelerator: ACCELERATORS[step],
        enabled: available[step],
        click: () => run({ action: HISTORY_ACTIONS[step] }),
      })),
    watch(win, menu) {
      const pages = win.webContents.navigationHistory;
      const sync = (): void => {
        if (win.isDestroyed()) return;
        const shown = menu();
        for (const step of STEPS) {
          available[step] = canStep(pages, step);
          const item = shown?.getMenuItemById(HISTORY_ACTIONS[step]);
          if (item) item.enabled = available[step];
        }
      };
      const take = (_event: unknown, gesture: string): void => {
        const step = GESTURES.get(gesture);
        if (!step || win.isDestroyed() || !canStep(pages, step)) return;
        if (step === 'back') pages.goBack();
        else pages.goForward();
      };
      // macOS sends a swipe only with Trackpad › Swipe between pages set to two or three fingers.
      win.on('swipe', take);
      win.on('app-command', take);
      win.on('focus', sync);
      win.webContents.on('did-navigate', sync);
      win.webContents.on('did-navigate-in-page', sync);
    },
  };
}

/** The app's one: the menu shows the focused window's history. */
export const historyMenu = createHistoryMenu();
