// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { EventEmitter } from 'node:events';
import type { ControlledWindow, WindowEvent } from '../../src/main/window-controls';

/** A BrowserWindow stand-in that changes state and emits the events Electron would. */
export function fakeWindow(): ControlledWindow & {
  readonly events: EventEmitter;
  setFocused(focused: boolean): void;
  closed: boolean;
} {
  const events = new EventEmitter();
  let focused = true;
  let maximized = false;
  let minimized = false;
  let fullScreen = false;
  let edited = false;
  const emit = (event: WindowEvent) => events.emit(event);
  const win = {
    events,
    closed: false,
    isDestroyed: () => win.closed,
    isFocused: () => focused,
    isMaximized: () => maximized,
    isMinimized: () => minimized,
    isFullScreen: () => fullScreen,
    isDocumentEdited: () => edited,
    setDocumentEdited: (flag: boolean) => {
      edited = flag;
    },
    close: () => {
      win.closed = true;
    },
    minimize: () => {
      minimized = true;
      focused = false;
      emit('minimize');
      emit('blur');
    },
    maximize: () => {
      maximized = true;
      emit('maximize');
    },
    unmaximize: () => {
      maximized = false;
      emit('unmaximize');
    },
    setFullScreen: (flag: boolean) => {
      fullScreen = flag;
      emit(flag ? 'enter-full-screen' : 'leave-full-screen');
    },
    setFocused: (flag: boolean) => {
      focused = flag;
      emit(flag ? 'focus' : 'blur');
    },
    on: (event: WindowEvent, listener: () => void) => events.on(event, listener),
    removeListener: (event: WindowEvent, listener: () => void) => events.removeListener(event, listener),
  };
  return win;
}
