// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, type AppClient, type WindowState } from '@taalcut/core';
import type { WindowAction } from '@taalcut/ui';

/**
 * The window this page lives in, for the window bar: its state as it
 * changes, and the traffic controls' actions. Electron only (appContract.window
 * over main's port); a plain browser has no window to drive, so its bar is
 * drawn with inert controls.
 */
export interface WindowClient {
  /** Calls `listener` with the state now, then with every change. Returns a stop function. */
  watch(listener: (state: WindowState) => void): () => void;
  /** True when main carried it out. `allWindows`: Option-click on close or minimise. */
  act(action: WindowAction, options: { allWindows: boolean }): Promise<boolean>;
  /** The system's double-click action (zoom, minimise or nothing), for a double-click that reached the page. */
  doubleClick(): Promise<boolean>;
  /** Unsaved changes in this window: the close control shows a dot. */
  setEdited(edited: boolean): Promise<boolean>;
}

export function windowClientOverRpc(client: AppClient['window']): WindowClient {
  const ok = async (call: Promise<unknown>) => {
    const result = await callRpc(call);
    if (!result.ok) console.error('The window did not answer', result.error);
    return result.ok;
  };
  return {
    watch(listener) {
      const controller = new AbortController();
      void (async () => {
        try {
          const stream = await client.changed(undefined, { signal: controller.signal });
          for await (const state of stream) listener(state);
        } catch (error) {
          if (!controller.signal.aborted) console.error('Lost the window’s state', error);
        }
      })();
      return () => controller.abort();
    },
    act(action, { allWindows }) {
      switch (action) {
        case 'close':
          return ok(client.close({ allWindows }));
        case 'minimize':
          return ok(client.minimize({ allWindows }));
        case 'zoom':
          return ok(client.zoom());
        case 'fullScreen':
          return ok(client.toggleFullScreen());
      }
    },
    doubleClick: () => ok(client.doubleClick()),
    setEdited: (edited) => ok(client.setEdited({ edited })),
  };
}
