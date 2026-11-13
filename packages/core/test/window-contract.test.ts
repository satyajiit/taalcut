// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  callRpc,
  connectRpc,
  doubleClickAction,
  serveRpc,
  windowContract,
  windowRouter,
  type DoubleClickAction,
  type WindowService,
  type WindowState,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { channel } from './helpers/ports';

/** A window that does what it's told and reports it, like main's BrowserWindow adapter. */
function fakeWindow(doubleClick: DoubleClickAction = 'maximize') {
  let state: WindowState = {
    focused: true,
    maximized: false,
    minimized: false,
    fullScreen: false,
    edited: false,
    doubleClick,
  };
  const listeners = new Set<(state: WindowState) => void>();
  const calls: string[] = [];
  const set = (change: Partial<WindowState>) => {
    state = { ...state, ...change };
    for (const listener of listeners) listener(state);
  };
  const window: WindowService = {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: (options) => void calls.push(options?.allWindows ? 'close all' : 'close'),
    minimize: (options) => {
      calls.push(options?.allWindows ? 'minimize all' : 'minimize');
      set({ minimized: true });
    },
    setEdited: (edited) => set({ edited }),
    zoom: () => {
      calls.push('zoom');
      set({ maximized: !state.maximized });
    },
    toggleFullScreen: () => {
      calls.push('fullScreen');
      set({ fullScreen: !state.fullScreen });
    },
  };
  return { window, calls, set, listeners };
}

/** Two windows behind one router; each connection's context names its own. */
function connect(windows: Record<string, WindowService>, id: string) {
  const { port1, port2 } = channel();
  serveRpc(
    windowRouter<{ windowId: string }>((context) => windows[context.windowId] ?? null),
    port1,
    { context: { windowId: id } },
  );
  return connectRpc(windowContract, port2, { peer: 'main' }).client;
}

describe('window contract', () => {
  it('acts on the caller’s own window only', async () => {
    const a = fakeWindow();
    const b = fakeWindow();
    const client = connect({ a: a.window, b: b.window }, 'b');
    await client.zoom();
    await client.minimize();
    await client.toggleFullScreen();
    await client.close();
    expect(b.calls).toEqual(['zoom', 'minimize', 'fullScreen', 'close']);
    expect(a.calls).toEqual([]);
    expect(await client.state()).toMatchObject({ maximized: true, minimized: true, fullScreen: true });
  });

  it('Option-click widens close and minimise to every window; edited shows in the state', async () => {
    const a = fakeWindow();
    const client = connect({ a: a.window }, 'a');
    await client.minimize({ allWindows: true });
    await client.close({ allWindows: false });
    await client.close({ allWindows: true });
    expect(a.calls).toEqual(['minimize all', 'close', 'close all']);
    await client.setEdited({ edited: true });
    expect(await client.state()).toMatchObject({ edited: true });
  });

  it('streams the state, then each change, and stops when the caller does', async () => {
    const a = fakeWindow();
    const client = connect({ a: a.window }, 'a');
    const controller = new AbortController();
    const stream = await client.changed(undefined, { signal: controller.signal });
    const first = await stream.next();
    expect(first.value).toMatchObject({ focused: true, maximized: false });
    a.set({ focused: false });
    expect((await stream.next()).value).toMatchObject({ focused: false });
    controller.abort();
    await expect(stream.next()).rejects.toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(a.listeners.size).toBe(0);
  });

  it('runs the system’s double-click action', async () => {
    for (const [action, expected] of [
      ['maximize', ['zoom']],
      ['minimize', ['minimize']],
      ['none', []],
    ] as const) {
      const a = fakeWindow(action);
      await connect({ a: a.window }, 'a').doubleClick();
      expect(a.calls).toEqual(expected);
    }
  });

  it('a window that is gone answers not found', async () => {
    const result = await callRpc(connect({}, 'gone').zoom());
    expect(result).toMatchObject({ ok: false, error: { code: 'core.not_found' } });
  });

  it('reads macOS’s AppleActionOnDoubleClick values', () => {
    expect(doubleClickAction('Maximize')).toBe('maximize');
    expect(doubleClickAction('Fill')).toBe('maximize');
    expect(doubleClickAction('')).toBe('maximize');
    expect(doubleClickAction(null)).toBe('maximize');
    expect(doubleClickAction('Minimize')).toBe('minimize');
    expect(doubleClickAction('None')).toBe('none');
  });
});
