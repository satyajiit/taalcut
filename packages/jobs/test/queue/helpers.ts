// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach } from 'vitest';
import {
  createJobEngine,
  MemoryJobStore,
  type JobEngine,
  type JobEngineOptions,
  type JobEvent,
  type PowerState,
  type ThermalState,
} from '../../src/index';

const engines: JobEngine[] = [];

afterEach(async () => {
  while (engines.length > 0) await engines.pop()!.stop({ graceMs: 0 });
});

/** Events the engine emitted, in order. */
export function eventLog() {
  const events: JobEvent[] = [];
  return {
    events,
    sink: { emit: (event: JobEvent) => events.push(event) },
    ofType: <T extends JobEvent['type']>(type: T) =>
      events.filter((e): e is Extract<JobEvent, { type: T }> => e.type === type),
  };
}

/** Fast timings so tests run in milliseconds; stopped after each test. */
export function testEngine(options: Partial<JobEngineOptions> = {}) {
  const store = (options.store as MemoryJobStore | undefined) ?? new MemoryJobStore();
  const log = eventLog();
  const engine = createJobEngine({
    leaseMs: 300,
    heartbeatMs: 40,
    pollMs: 20,
    progressIntervalMs: 30,
    backoff: { baseMs: 15, factor: 2, jitter: 0 },
    events: log.sink,
    ...options,
    store,
  });
  engines.push(engine);
  return { engine, store, ...log };
}

/** A PowerState the test flips. */
export function fakePower(initial: { onBattery?: boolean; thermalState?: ThermalState } = {}) {
  const listeners = new Set<() => void>();
  const state = { onBattery: initial.onBattery ?? false, thermalState: initial.thermalState ?? 'nominal' };
  const power: PowerState & { set(next: Partial<typeof state>): void } = {
    get onBattery() {
      return state.onBattery;
    },
    get thermalState() {
      return state.thermalState;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      Object.assign(state, next);
      for (const listener of listeners) listener();
    },
  };
  return power;
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A store whose clock steps by 1 ms per read, so enqueue order is claim order at equal priority. */
export function steppingStore(): MemoryJobStore {
  let now = 1_000;
  return new MemoryJobStore({ clock: () => now++ });
}

/** Polls until `predicate` holds, or throws after `timeoutMs`. */
export async function waitFor(predicate: () => boolean, timeoutMs = 3000, what = 'condition'): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Resolves after `ms`, or rejects with the signal's reason when it aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}
