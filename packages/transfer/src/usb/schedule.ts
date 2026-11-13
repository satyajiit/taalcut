// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Tests pass a clock-driven stand-in so the 5s busy timeout is not a real wait. */
export type Schedule = (ms: number, fn: () => void) => { cancel(): void };

export function defaultSchedule(ms: number, fn: () => void): { cancel(): void } {
  const timer = setTimeout(fn, Math.max(0, ms));
  timer.unref();
  return { cancel: () => clearTimeout(timer) };
}
