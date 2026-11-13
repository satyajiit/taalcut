// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Wall-clock time as a service, so timestamps in audit logs, events and jobs
 * are deterministic in tests.
 */
import { createToken } from '../di/token';

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export const ClockToken = createToken<Clock>('core.clock');

export const systemClock: Clock = { now: () => Date.now() };

export interface ManualClock extends Clock {
  set(ms: number): void;
  advance(ms: number): void;
}

/** A clock that only moves when told to. For tests. */
export function createManualClock(startMs = 0): ManualClock {
  let current = startMs;
  return {
    now: () => current,
    set: (ms) => {
      current = ms;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}
