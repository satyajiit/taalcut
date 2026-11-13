// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One still per second of the clip, capped at the look pool. Times sit in the
 * middle of each slice so an end-exclusive frame extract still lands inside.
 */
import { RationalTime, type TimeRange } from '@taalcut/core';
import { LOOK_POOL_FRAMES } from './look-stats';

/** How many stills to pull. An empty range still asks for one, at the start. */
export function frameCountFor(range: TimeRange): number {
  const span = RationalTime.toSeconds(range.duration);
  if (span <= 0) return 1;
  return Math.min(LOOK_POOL_FRAMES, Math.max(1, Math.ceil(span)));
}

/** Seconds from the start of the asset, one per slice. */
export function sampleSeconds(range: TimeRange, count: number): readonly number[] {
  const start = RationalTime.toSeconds(range.start);
  const span = RationalTime.toSeconds(range.duration);
  const n = Number.isInteger(count) && count > 0 ? Math.min(count, LOOK_POOL_FRAMES) : 1;
  if (span <= 0) return [start];
  const times: number[] = [];
  for (let i = 0; i < n; i += 1) times.push(start + ((i + 0.5) * span) / n);
  return times;
}
