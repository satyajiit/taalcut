// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Trend dates (P3-V14). Older than `templates.staleAfterDays` shows "Trend may be stale". */
import type { TrendFreshness } from '@taalcut/core';

const DAY_MS = 86_400_000;

export function trendFreshnessOf(
  date: string | null,
  source: TrendFreshness['source'],
): TrendFreshness | null {
  if (date === null) return null;
  return { date, source };
}

/** True when `date` (YYYY-MM-DD, UTC) is strictly older than `staleAfterDays` at `now`. */
export function isStale(date: string, now: number, staleAfterDays: number): boolean {
  const then = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(then) && now - then > staleAfterDays * DAY_MS;
}
