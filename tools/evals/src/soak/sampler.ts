// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type SoakClock } from './scenario';

/** Full-run RSS cadence: app metrics, database size, and queue depth. */
export const SAMPLE_INTERVAL_MS = 10_000;

export interface TimelineEvent {
  at: number;
  kind: string;
}

/** Sample offsets from 0 through `durationMs`, including both ends. */
export function sampleTimes(durationMs: number, intervalMs: number): number[] {
  if (!Number.isFinite(durationMs) || durationMs < 0)
    throw new Error('duration must be a non-negative number');
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('sample interval must be positive');
  const times: number[] = [];
  for (let at = 0; at < durationMs; at += intervalMs) times.push(at);
  times.push(durationMs);
  return times;
}

/**
 * Work events keep their relative order. Samples at the same instant run after the work,
 * so a reading sees the import or upload that just landed.
 */
export function mergeEvents(work: readonly TimelineEvent[], sampleAt: readonly number[]): TimelineEvent[] {
  const events: TimelineEvent[] = [...work, ...sampleAt.map((at) => ({ at, kind: 'sample' }))];
  events.sort((left, right) => left.at - right.at || kindOrder(left.kind) - kindOrder(right.kind));
  return events;
}

function kindOrder(kind: string): number {
  if (kind === 'sample') return 2;
  if (kind === 'upload') return 1;
  return 0;
}

/** Sleeps the fake or real clock up to each event, then handles it. Time is relative to entry. */
export async function playEvents(
  clock: SoakClock,
  events: readonly TimelineEvent[],
  handle: (event: TimelineEvent) => Promise<void>,
): Promise<void> {
  const origin = clock.now();
  let cursor = origin;
  for (const event of events) {
    const target = origin + event.at;
    if (target > cursor) {
      await clock.sleep(target - cursor);
      cursor = clock.now();
    }
    await handle(event);
  }
}
