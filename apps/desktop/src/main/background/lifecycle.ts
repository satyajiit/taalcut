// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { BACKGROUND_SWITCH } from './native-registration';

interface ForegroundWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
}

/** Keep the user's window separate from offscreen render/capture windows created by background work. */
export function foregroundWindow<T extends ForegroundWindow, Id>(options: {
  create(id?: Id): T;
  focusItem(id: Id): void;
}) {
  let current: T | undefined;
  return {
    show(id?: Id): { window: T; created: boolean } {
      if (current && !current.isDestroyed()) {
        if (current.isMinimized()) current.restore();
        current.focus();
        if (id !== undefined) options.focusItem(id);
        return { window: current, created: false };
      }
      current = options.create(id);
      return { window: current, created: true };
    },
  };
}

export function isBackgroundLaunch(argv: readonly string[]): boolean {
  return argv.includes(`--${BACKGROUND_SWITCH}`);
}

/** Wakes arriving before composition finishes are coalesced; ordinary launches keep their request to show UI. */
export function backgroundLaunchIntents() {
  let open: (() => void) | undefined;
  let wake: (() => void) | undefined;
  let wantsWindow = false;
  let wantsWake = false;
  return {
    receive(argv: readonly string[]) {
      if (isBackgroundLaunch(argv)) {
        if (wake) wake();
        else wantsWake = true;
      } else {
        if (open) open();
        else wantsWindow = true;
      }
    },
    bind(callbacks: { open(): void; wake(): void }) {
      open = callbacks.open;
      wake = callbacks.wake;
      if (wantsWake) {
        wantsWake = false;
        wake();
      }
      if (wantsWindow) {
        wantsWindow = false;
        open();
      }
    },
  };
}
