// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A window as main/open-clips.ts reads one: its page's URL, and Electron's events for it going elsewhere or away. */
import { EventEmitter } from 'node:events';
import type { ClipWindow } from '../../src/main/open-clips';

const ORIGIN = 'app://taalcut';

export interface FakeClipWindow extends ClipWindow {
  /** The router moves the page (history.pushState): did-navigate-in-page. */
  go(path: string): void;
  /** A load or reload: did-navigate. */
  load(path: string): void;
  /** The page's renderer crashed. */
  crash(): void;
  close(): void;
}

let ids = 0;

export function fakeClipWindow(path = '/library'): FakeClipWindow {
  const window = new EventEmitter();
  const contents = new EventEmitter();
  let url = `${ORIGIN}${path}`;
  return {
    id: ++ids,
    on: (event, listener) => window.on(event, listener),
    webContents: {
      getURL: () => url,
      on: (event, listener) => contents.on(event, listener),
    },
    go(next) {
      url = `${ORIGIN}${next}`;
      contents.emit('did-navigate-in-page');
    },
    load(next) {
      url = `${ORIGIN}${next}`;
      contents.emit('did-navigate');
    },
    crash: () => void contents.emit('render-process-gone'),
    close: () => void window.emit('closed'),
  };
}
