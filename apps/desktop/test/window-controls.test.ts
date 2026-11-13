// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { WindowState } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createWindowService, WINDOW_EVENTS } from '../src/main/window-controls';
import { fakeWindow } from './helpers/fake-window';

describe('the window bar’s window', () => {
  it('reports focus, zoom, minimise and full screen, and the double-click setting', () => {
    const win = fakeWindow();
    let setting: string | null = null;
    const service = createWindowService(win, () => setting);
    expect(service.state()).toEqual({
      focused: true,
      maximized: false,
      minimized: false,
      fullScreen: false,
      edited: false,
      doubleClick: 'maximize',
    });
    setting = 'Minimize';
    expect(service.state().doubleClick).toBe('minimize');
    setting = 'None';
    expect(service.state().doubleClick).toBe('none');
  });

  it('zoom toggles, full screen toggles, minimise and close act on the window', () => {
    const win = fakeWindow();
    const service = createWindowService(win, () => null);
    service.zoom();
    expect(win.isMaximized()).toBe(true);
    service.zoom();
    expect(win.isMaximized()).toBe(false);
    service.toggleFullScreen();
    expect(win.isFullScreen()).toBe(true);
    service.toggleFullScreen();
    expect(win.isFullScreen()).toBe(false);
    service.minimize();
    expect(win.isMinimized()).toBe(true);
    service.close();
    expect(win.isDestroyed()).toBe(true);
  });

  it('Option-click closes or minimises every window; edited marks the window and is sent', () => {
    const win = fakeWindow();
    const other = fakeWindow();
    const service = createWindowService(
      win,
      () => null,
      () => [win, other],
    );
    const seen: WindowState[] = [];
    service.subscribe((state) => seen.push(state));
    service.minimize();
    expect([win.isMinimized(), other.isMinimized()]).toEqual([true, false]);
    service.minimize({ allWindows: true });
    expect(other.isMinimized()).toBe(true);
    service.setEdited(true);
    expect(win.isDocumentEdited()).toBe(true);
    expect(seen.at(-1)).toMatchObject({ edited: true });
    service.close({ allWindows: true });
    expect([win.isDestroyed(), other.isDestroyed()]).toEqual([true, true]);
  });

  it('sends each distinct state once, and stops listening', () => {
    const win = fakeWindow();
    const service = createWindowService(win, () => null);
    const seen: WindowState[] = [];
    const before = WINDOW_EVENTS.map((event) => win.events.listenerCount(event));
    const off = service.subscribe((state) => seen.push(state));
    win.setFocused(false);
    win.events.emit('resized'); // nothing changed
    win.setFocused(true);
    service.zoom();
    expect(seen.map((state) => [state.focused, state.maximized])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
    off();
    expect(WINDOW_EVENTS.map((event) => win.events.listenerCount(event))).toEqual(before);
  });

  it('stays quiet once the window is gone', () => {
    const win = fakeWindow();
    const service = createWindowService(win, () => null);
    const seen: WindowState[] = [];
    const off = service.subscribe((state) => seen.push(state));
    win.close();
    win.events.emit('blur');
    expect(seen).toEqual([]);
    expect(() => off()).not.toThrow();
  });
});
