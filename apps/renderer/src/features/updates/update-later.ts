// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Later" on a staged update (P3-B9): the dialog comes back once on the next launch for that version, never
 * mid-task. Kept in this window's storage, a per-Mac courtesy rather than a setting; blocked storage only means the
 * dialog waits for the person to open it from About.
 */
const LATER_KEY = 'taalcut.update.later';

export function rememberLater(version: string): void {
  try {
    window.localStorage.setItem(LATER_KEY, version);
  } catch {
    // Storage blocked: About and the sidebar item still open the dialog.
    return;
  }
}

/** The version the person said Later to, if any. */
export function laterVersion(): string | null {
  try {
    return window.localStorage.getItem(LATER_KEY);
  } catch {
    return null;
  }
}
