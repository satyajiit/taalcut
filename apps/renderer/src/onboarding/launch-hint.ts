// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Where the last launch went: the app, or first run. Guesses this launch's screen; never decides it. */
export type LaunchHint = 'app' | 'setup';
const HINT_KEY = 'taalcut.launch';

export function readLaunchHint(): LaunchHint {
  try {
    return window.localStorage.getItem(HINT_KEY) === 'app' ? 'app' : 'setup';
  } catch {
    // Storage can be off (private mode): guess first run, the screen a new profile opens on.
    return 'setup';
  }
}

export function writeLaunchHint(hint: LaunchHint): void {
  try {
    window.localStorage.setItem(HINT_KEY, hint);
  } catch {
    // Storage can be off: the next launch guesses again, nothing else changes.
  }
}
