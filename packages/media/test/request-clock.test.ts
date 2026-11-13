// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startRequestClock as start,
  type ClockExpiry,
  type RequestClockOptions,
} from '../src/sidecar/request-clock';

/** The clock with "after this turn's input" as a 1 ms timer: it runs after the timers due when it was set. */
const startRequestClock = (options: RequestClockOptions, onExpire: (expiry: ClockExpiry) => void) =>
  start(options, onExpire, (callback) => setTimeout(callback, 1));

describe('request clock (FIX-OCRCOLD)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits out a helper that keeps saying it is working, up to the cap', () => {
    const expired: ClockExpiry[] = [];
    const clock = startRequestClock({ timeoutMs: 600_000, stallTimeoutMs: 30_000 }, (e) => expired.push(e));
    // A four-minute compile, a keepalive every two seconds.
    for (let t = 0; t < 240_000; t += 2_000) {
      vi.advanceTimersByTime(2_000);
      clock.touch();
    }
    expect(expired).toEqual([]);
    clock.clear();
    vi.advanceTimersByTime(1_000_000);
    expect(expired).toEqual([]);
  });

  it('gives up at the stall once the helper goes quiet', () => {
    const expired: ClockExpiry[] = [];
    const clock = startRequestClock({ timeoutMs: 600_000, stallTimeoutMs: 30_000 }, (e) => expired.push(e));
    vi.advanceTimersByTime(10_000);
    clock.touch();
    vi.advanceTimersByTime(29_999);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(expired).toEqual([{ kind: 'stall', ms: 30_000 }]);
    // Once only, and nothing after.
    clock.touch();
    vi.advanceTimersByTime(1_000_000);
    expect(expired).toHaveLength(1);
  });

  it('still gives up at the cap however often the helper beats', () => {
    const expired: ClockExpiry[] = [];
    const clock = startRequestClock({ timeoutMs: 600_000, stallTimeoutMs: 30_000 }, (e) => expired.push(e));
    for (let t = 0; t < 700_000; t += 2_000) {
      vi.advanceTimersByTime(2_000);
      clock.touch();
    }
    expect(expired).toEqual([{ kind: 'cap', ms: 600_000 }]);
  });

  it('keeps the fixed timeout when there is no stall wait (a helper without a keepalive)', () => {
    const expired: ClockExpiry[] = [];
    const clock = startRequestClock({ timeoutMs: 60_000 }, (e) => expired.push(e));
    vi.advanceTimersByTime(30_000);
    clock.touch();
    vi.advanceTimersByTime(30_000);
    expect(expired).toEqual([{ kind: 'cap', ms: 60_000 }]);
    const none: ClockExpiry[] = [];
    startRequestClock({}, (e) => none.push(e));
    vi.advanceTimersByTime(10_000_000);
    expect(none).toEqual([]);
  });

  it("doesn't call a stall when a line arrives in the same turn the stall timer fires", () => {
    const expired: ClockExpiry[] = [];
    const clock = startRequestClock({ stallTimeoutMs: 30_000 }, (e) => expired.push(e));
    // This process's loop was blocked: the stall timer and the helper's waiting line come due in one turn, and the
    // line is read (poll phase) before the recheck runs (check phase).
    setTimeout(() => clock.touch(), 30_000);
    vi.advanceTimersByTime(30_005);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(30_000);
    expect(expired).toEqual([{ kind: 'stall', ms: 30_000 }]);
  });
});
