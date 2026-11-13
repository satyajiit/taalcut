// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Back and Forward outside the page (UX1 nav): the View menu's items run the
 * page's own steps and are enabled only when there is a step to take; a
 * swipe and the mouse's buttons step the window's history; neither steps
 * from the app into first run. The Help menu sends the palette's Help ids.
 */
import { EventEmitter } from 'node:events';
import { createEventBus, createUiCommands, systemClock, type UiAction } from '@taalcut/core';
import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { appMenuTemplate } from '../src/main/composition/app-menu';
import { mainI18n } from '../src/main/i18n/i18n';
import { HELP_ACTIONS } from '../src/main/menu/help-navigation';
import {
  canStep,
  createHistoryMenu,
  type NavigableWindow,
  type PageHistory,
} from '../src/main/menu/navigation';

const MAC = { appMenu: true, keyboard: 'mac' } as const;

const ORIGIN = 'taalcut://app';

/** A window's history as Electron keeps it: entries, the one shown, back and forward moving between them. */
function pages(paths: readonly string[], active = paths.length - 1): PageHistory & { active: number } {
  const history = {
    active,
    canGoBack: () => history.active > 0,
    canGoForward: () => history.active < paths.length - 1,
    goBack: () => void (history.active -= 1),
    goForward: () => void (history.active += 1),
    getActiveIndex: () => history.active,
    getEntryAtIndex: (index: number) => {
      const path = paths[index];
      return path === undefined ? null : { url: `${ORIGIN}${path}` };
    },
  };
  return history;
}

function fakeWindow(history: PageHistory): NavigableWindow & {
  readonly window: EventEmitter;
  readonly contents: EventEmitter;
  destroyed: boolean;
} {
  const window = new EventEmitter();
  const contents = new EventEmitter();
  const win = {
    window,
    contents,
    destroyed: false,
    isDestroyed: () => win.destroyed,
    on: (event: string, listener: ((event: unknown, gesture: string) => void) | (() => void)) =>
      window.on(event, listener),
    webContents: {
      navigationHistory: history,
      on: (event: string, listener: () => void) => contents.on(event, listener),
    },
  };
  return win;
}

/** The shown menu's two items, found by id as Menu.getMenuItemById finds them. */
function shownMenu() {
  const items = new Map([
    ['nav.back', { enabled: false }],
    ['nav.forward', { enabled: false }],
  ]);
  return { items, getMenuItemById: (id: string) => items.get(id) ?? null };
}

const english = mainI18n('en');
const text = (message: { id: string; message?: string }) => english._(message);
const commands = createUiCommands({ events: createEventBus({ clock: systemClock }) }).all;
const submenu = (menu: MenuItemConstructorOptions[], label: string) =>
  (menu.find((entry) => entry.label === label)?.submenu ?? []) as MenuItemConstructorOptions[];
const click = (item: MenuItemConstructorOptions | undefined) => (item?.click as () => void)();

describe('Back and Forward in the View menu', () => {
  it('leads View with Back (⌘[) and Forward (⌘]), sending the palette items’ ids', () => {
    const run = vi.fn<(action: UiAction) => void>();
    const view = submenu(
      appMenuTemplate({
        policy: MAC,
        appName: 'Taalcut',
        development: false,
        i18n: english,
        commands,
        run,
      }),
      'View',
    );
    expect(view.slice(0, 3).map((entry) => [entry.id, entry.label, entry.accelerator, entry.type])).toEqual([
      ['nav.back', 'Back', 'CmdOrCtrl+[', undefined],
      ['nav.forward', 'Forward', 'CmdOrCtrl+]', undefined],
      [undefined, undefined, undefined, 'separator'],
    ]);
    click(view[0]);
    click(view[1]);
    expect(run.mock.calls).toEqual([[{ action: 'nav.back' }], [{ action: 'nav.forward' }]]);
  });

  it('enables each item as the focused window’s history changes, and a rebuilt menu starts that way', () => {
    const menu = createHistoryMenu();
    expect(menu.items(text, vi.fn()).map((item) => item.enabled)).toEqual([false, false]);
    const history = pages(['/chat', '/library', '/library/01J']);
    const win = fakeWindow(history);
    const shown = shownMenu();
    menu.watch(win, () => shown);
    win.contents.emit('did-navigate-in-page');
    expect([...shown.items.values()].map((item) => item.enabled)).toEqual([true, false]);
    history.active = 1;
    win.contents.emit('did-navigate-in-page');
    expect([...shown.items.values()].map((item) => item.enabled)).toEqual([true, true]);
    history.active = 0;
    win.window.emit('focus');
    expect([...shown.items.values()].map((item) => item.enabled)).toEqual([false, true]);
    // The language changed: the menu is built again, with the items as they are now.
    expect(menu.items(text, vi.fn()).map((item) => item.enabled)).toEqual([false, true]);
  });

  it('leaves a window that has closed alone', () => {
    const menu = createHistoryMenu();
    const win = fakeWindow(pages(['/chat', '/library']));
    const shown = shownMenu();
    menu.watch(win, () => shown);
    win.destroyed = true;
    win.contents.emit('did-navigate');
    expect(shown.items.get('nav.back')?.enabled).toBe(false);
  });
});

describe('swipes and mouse buttons', () => {
  it('steps back on a swipe left and forward on a swipe right; up and down do nothing', () => {
    const history = pages(['/chat', '/library', '/templates'], 1);
    const win = fakeWindow(history);
    createHistoryMenu().watch(win, () => null);
    win.window.emit('swipe', {}, 'left');
    expect(history.active).toBe(0);
    win.window.emit('swipe', {}, 'right');
    win.window.emit('swipe', {}, 'right');
    expect(history.active).toBe(2);
    win.window.emit('swipe', {}, 'up');
    win.window.emit('swipe', {}, 'down');
    win.window.emit('swipe', {}, 'right');
    expect(history.active).toBe(2);
  });

  it("answers the mouse's back and forward buttons (app-command, Windows and Linux)", () => {
    const history = pages(['/chat', '/library'], 1);
    const win = fakeWindow(history);
    createHistoryMenu().watch(win, () => null);
    win.window.emit('app-command', {}, 'browser-backward');
    expect(history.active).toBe(0);
    win.window.emit('app-command', {}, 'browser-forward');
    expect(history.active).toBe(1);
    win.window.emit('app-command', {}, 'media-play-pause');
    expect(history.active).toBe(1);
  });

  it('never steps from the app back into first run, nor across it from onboarding', () => {
    const history = pages(['/onboarding/welcome', '/onboarding/ready', '/chat', '/library'], 2);
    expect(canStep(history, 'back')).toBe(false);
    expect(canStep(history, 'forward')).toBe(true);
    const win = fakeWindow(history);
    createHistoryMenu().watch(win, () => null);
    win.window.emit('swipe', {}, 'left');
    expect(history.active).toBe(2);
    // Within first run, back works as it always has.
    history.active = 1;
    expect(canStep(history, 'back')).toBe(true);
    expect(canStep(pages(['/library'], 0), 'back')).toBe(false);
  });
});

describe('the Help menu', () => {
  it('ends the menu bar with Help: Send Feedback…, then the project on GitHub', () => {
    const run = vi.fn<(action: UiAction) => void>();
    const menu = appMenuTemplate({
      policy: MAC,
      appName: 'Taalcut',
      development: false,
      i18n: english,
      commands,
      run,
    });
    const help = menu.at(-1);
    expect(help?.role).toBe('help');
    const items = submenu(menu, 'Help');
    expect(items.map((entry) => entry.label ?? entry.type)).toEqual([
      'Send Feedback…',
      'separator',
      'Star Taalcut on GitHub',
      'Report an Issue on GitHub',
      'Request a Feature on GitHub',
    ]);
    for (const item of items) if (item.click) click(item);
    expect(run.mock.calls.map(([action]) => action.action)).toEqual(Object.values(HELP_ACTIONS));
    expect(Object.values(HELP_ACTIONS)).toEqual([
      'help.feedback',
      'help.github',
      'help.reportIssue',
      'help.requestFeature',
    ]);
  });
});
