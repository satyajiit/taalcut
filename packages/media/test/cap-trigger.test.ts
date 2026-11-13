// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** When the cache's cap is enforced (UX2 round 3): one run per burst, after the delay, never two at once. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapTrigger } from '../src/cache/cap-trigger';

describe('the cap trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A run that ends when the test says so. */
  function runs() {
    const started: (() => void)[] = [];
    const run = () => new Promise<void>((resolve) => started.push(resolve));
    return { started, run };
  }

  it('makes one run for a burst of puts over the cap, after the delay', async () => {
    const { started, run } = runs();
    const trigger = createCapTrigger({ run, delayMs: 30_000, log: () => {} });
    for (let put = 0; put < 50; put++) trigger.overCap();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(started).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toHaveLength(1);
    started[0]?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(started).toHaveLength(1);
  });

  it('asks for one more run after the current one when a put crosses the cap meanwhile', async () => {
    const { started, run } = runs();
    const trigger = createCapTrigger({ run, delayMs: 1_000, log: () => {} });
    trigger.overCap();
    await vi.advanceTimersByTimeAsync(1_000);
    trigger.overCap();
    trigger.overCap();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(started).toHaveLength(1);
    started[0]?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started).toHaveLength(2);
  });

  it('says when a run failed and keeps going; stop cancels the run asked for', async () => {
    const logged: string[] = [];
    let calls = 0;
    const trigger = createCapTrigger({
      run: () => {
        calls++;
        return Promise.reject(new Error('queue closed'));
      },
      delayMs: 10,
      log: (message) => logged.push(message),
    });
    trigger.overCap();
    await vi.advanceTimersByTimeAsync(10);
    expect(logged).toEqual(["the cache's cap wasn't enforced: queue closed"]);
    trigger.overCap();
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toBe(2);
    trigger.overCap();
    trigger.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(2);
  });
});
