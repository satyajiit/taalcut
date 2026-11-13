// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A quit by signal once an update is staged (P3-B9). Before staging, Electron turns SIGTERM, SIGINT and SIGHUP
 * into a normal quit. Once Squirrel.Mac has staged an update that no longer holds: measured on Electron 44.7, the
 * packaged app dies from the signal within 30 ms, with no before-quit or will-quit, so the update guard (started
 * at will-quit) never runs while ShipIt still installs the update. The cause is in Squirrel.framework: while it
 * hands the update to ShipIt it sets SIGHUP, SIGINT, SIGQUIT and SIGTERM to SIG_IGN and then back to SIG_DFL,
 * which drops Chromium's handlers. From the 'staged' event on, main takes those signals itself and quits the
 * normal way. One shot, as Chromium does: the first signal quits, and the listeners go, so a second signal ends
 * the app at once.
 */

export const QUIT_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;
export type QuitSignal = (typeof QUIT_SIGNALS)[number];

export interface SignalSource {
  on(signal: QuitSignal, listener: () => void): unknown;
  removeListener(signal: QuitSignal, listener: () => void): unknown;
}

export interface QuitSignals {
  /**
   * Takes the signals, afresh each time: Squirrel resets them on every staging, under listeners Node still
   * counts, so they are removed (Node puts the default back) and added again (Node installs its handler).
   */
  take(): void;
}

export function quitSignals(source: SignalSource, quit: (signal: QuitSignal) => void): QuitSignals {
  const held = new Map<QuitSignal, () => void>();
  const release = () => {
    for (const [signal, listener] of held) source.removeListener(signal, listener);
    held.clear();
  };
  return {
    take() {
      release();
      for (const signal of QUIT_SIGNALS) {
        const listener = () => {
          release();
          quit(signal);
        };
        held.set(signal, listener);
        source.on(signal, listener);
      }
    },
  };
}
