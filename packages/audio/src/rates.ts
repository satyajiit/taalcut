// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Rates audio stores. FrameRate.of reduces, so 1000/1 and 50/1 stay as written. */
import { FrameRate, RationalTime, TimeRange, type RationalTime as RationalTimeValue } from '@taalcut/core';

export const MILLISECONDS = FrameRate.of(1000, 1);
export const BEAT_FPS = FrameRate.of(50, 1);

export function msTime(ms: number): RationalTimeValue {
  return RationalTime.of(Math.round(ms), MILLISECONDS);
}

/** A range on the asset audio clock. `startMs` and `durationMs` are milliseconds. */
export function msRange(startMs: number, durationMs: number): TimeRange {
  return TimeRange.of(msTime(startMs), msTime(Math.max(0, durationMs)));
}

export function rangeToMs(range: TimeRange): { startMs: number; endMs: number } {
  const startMs = Math.round(RationalTime.toSeconds(range.start) * 1000);
  const endMs = Math.round(RationalTime.toSeconds(TimeRange.end(range)) * 1000);
  return { startMs, endMs };
}
