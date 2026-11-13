// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * First run's timing marks (docs/onboarding.md section 11) in this window's storage: when Get started was pressed,
 * how the first video was started. A per-window convenience: if storage is blocked (a private profile), the
 * marks aren't kept and the timing events are skipped; nothing else changes.
 */

export function setMark(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the event this mark times is skipped.
    return;
  }
}

export function readMark(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function clearMark(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage blocked: there was nothing kept to clear.
    return;
  }
}
