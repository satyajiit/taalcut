// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When the person pressed Get started, for `onboarding.imported { ms }` and `onboarding.firstExport { ms }`
 * (docs/onboarding.md section 11). A per-window convenience: if storage is unavailable the events aren't sent.
 */
import { readMark, setMark } from './timing-marks';

const KEY = 'taalcut.onboarding.startedAt';

export function markStarted(now = Date.now()): void {
  setMark(KEY, String(now));
}

export function msSinceStart(now = Date.now()): number | null {
  const at = Number(readMark(KEY));
  return Number.isFinite(at) && at > 0 ? Math.max(0, now - at) : null;
}
