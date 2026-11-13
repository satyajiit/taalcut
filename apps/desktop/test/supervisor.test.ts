// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logSupervisor } from '../src/main/composition/main-wiring';
import { backoffDelay, DEFAULT_BACKOFF } from '../src/main/utility/backoff';
import { utilityProcessTable } from '../src/main/utility/process-table';
import { STOP_DEADLINE_MS } from '../src/main/utility/stopping';
import {
  ProcessSupervisor,
  type ProcessSpec,
  type SupervisedChild,
  type SupervisorEvent,
} from '../src/main/utility/supervisor';

class FakeChild implements SupervisedChild {
  private exitListener: ((code: number) => void) | undefined;
  /** `exitOnKill` false: SIGTERM is ignored until the test calls exit() (a slow or wedged shutdown). */
  constructor(
    readonly pid: number,
    private readonly exitOnKill = true,
  ) {}
  kill(): boolean {
    if (this.exitOnKill) queueMicrotask(() => this.exit(0));
    return true;
  }
  once(_event: 'exit', listener: (code: number) => void): this {
    this.exitListener = listener;
    return this;
  }
  /** Simulates a crash (or a kill from outside). */
  exit(code: number): void {
    const listener = this.exitListener;
    this.exitListener = undefined;
    listener?.(code);
  }
}

const jobs: ProcessSpec = { name: 'jobs', modulePath: '/out/utility/stub.mjs', serviceName: 'Taalcut jobs' };
const lan: ProcessSpec = { name: 'lan', modulePath: '/out/utility/stub.mjs', serviceName: 'Taalcut LAN' };

describe('ProcessSupervisor', () => {
  let children: FakeChild[];
  let events: SupervisorEvent[];
  let supervisor: ProcessSupervisor;
  let fork: ReturnType<typeof vi.fn<(spec: ProcessSpec) => SupervisedChild>>;

  beforeEach(() => {
    vi.useFakeTimers();
    children = [];
    events = [];
    fork = vi.fn((_spec: ProcessSpec) => {
      const child = new FakeChild(1000 + children.length);
      children.push(child);
      return child;
    });
    supervisor = new ProcessSupervisor({ fork, now: () => Date.now() });
    supervisor.on((event) => events.push(event));
  });

  afterEach(() => vi.useRealTimers());

  it('forks a process once, even if started twice', () => {
    supervisor.start(jobs);
    supervisor.start(jobs);
    expect(fork).toHaveBeenCalledTimes(1);
    expect(supervisor.pid('jobs')).toBe(1000);
    expect(supervisor.isRunning('jobs')).toBe(true);
  });

  it('restarts a crashed process well within 2 s', () => {
    supervisor.start(jobs);
    children[0]?.exit(9);
    expect(supervisor.isRunning('jobs')).toBe(false);
    expect(events).toContainEqual({ type: 'exited', name: 'jobs', code: 9, expected: false });

    vi.advanceTimersByTime(DEFAULT_BACKOFF.initialMs);
    expect(fork).toHaveBeenCalledTimes(2);
    expect(supervisor.pid('jobs')).toBe(1001);
    expect(events.at(-1)).toEqual({ type: 'started', name: 'jobs', restarts: 1 });
    expect(DEFAULT_BACKOFF.initialMs).toBeLessThan(2_000);
  });

  it('backs off on a crash loop and resets after a stable run', () => {
    supervisor.start(jobs);
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      children.at(-1)?.exit(1);
      const scheduled = events.at(-1);
      if (scheduled?.type === 'restart-scheduled') delays.push(scheduled.delayMs);
      vi.advanceTimersByTime(delays.at(-1) ?? 0);
    }
    expect(delays).toEqual([250, 500, 1000, 2000, 4000]);

    // Runs long enough to count as stable, then crashes: back to the first delay.
    vi.advanceTimersByTime(DEFAULT_BACKOFF.stableAfterMs);
    children.at(-1)?.exit(1);
    expect(events.at(-1)).toMatchObject({ type: 'restart-scheduled', delayMs: 250, attempt: 0 });
  });

  it('does not restart a process it was asked to stop', async () => {
    supervisor.start(jobs);
    const stopped = supervisor.stop('jobs');
    await vi.runAllTimersAsync();
    await stopped;
    expect(events).toContainEqual({ type: 'exited', name: 'jobs', code: 0, expected: true });
    expect(fork).toHaveBeenCalledTimes(1);
    expect(supervisor.isRunning('jobs')).toBe(false);
  });

  it('cancels a pending restart on stop', async () => {
    supervisor.start(jobs);
    children[0]?.exit(1);
    await supervisor.stopAll();
    vi.advanceTimersByTime(60_000);
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('ignores a late exit from a child it already replaced', () => {
    supervisor.start(jobs);
    const first = children[0];
    first?.exit(1);
    vi.advanceTimersByTime(250);
    first?.exit(1);
    expect(supervisor.pid('jobs')).toBe(1001);
  });

  it('retries with backoff when fork itself throws', () => {
    fork.mockImplementationOnce(() => {
      throw new Error('ENOENT stub.mjs');
    });
    supervisor.start(jobs);
    expect(events[0]).toEqual({ type: 'spawn-failed', name: 'jobs', detail: 'Error: ENOENT stub.mjs' });
    expect(events[1]).toMatchObject({ type: 'restart-scheduled', delayMs: 250 });
    vi.advanceTimersByTime(250);
    expect(supervisor.isRunning('jobs')).toBe(true);
  });

  it('can stop a name it never started', async () => {
    await expect(supervisor.stop('lan')).resolves.toBeUndefined();
  });

  it('lets a listener unsubscribe', () => {
    const seen: SupervisorEvent[] = [];
    const off = supervisor.on((event) => seen.push(event));
    off();
    supervisor.start(jobs);
    expect(seen).toEqual([]);
  });
});

describe('ProcessSupervisor: one process per name', () => {
  let children: FakeChild[];
  let events: SupervisorEvent[];
  let signals: [number, string][];
  let supervisor: ProcessSupervisor;
  let fork: ReturnType<typeof vi.fn<(spec: ProcessSpec) => SupervisedChild>>;

  beforeEach(() => {
    vi.useFakeTimers();
    children = [];
    events = [];
    signals = [];
    // Each child takes its time to exit after SIGTERM, like a lan process disposing its runs.
    fork = vi.fn((_spec: ProcessSpec) => {
      const child = new FakeChild(2000 + children.length, false);
      children.push(child);
      return child;
    });
    supervisor = new ProcessSupervisor({
      fork,
      now: () => Date.now(),
      signal: (pid, signal) => signals.push([pid, signal]),
    });
    supervisor.on((event) => events.push(event));
  });

  afterEach(() => vi.useRealTimers());

  it('forks the next process of a name only after the stopped one has exited', async () => {
    supervisor.start(lan);
    const stopped = supervisor.stop('lan');
    supervisor.start(lan);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fork).toHaveBeenCalledTimes(1);
    expect(supervisor.isRunning('lan')).toBe(false);

    children[0]?.exit(0);
    await stopped;
    await vi.advanceTimersByTimeAsync(0);
    expect(fork).toHaveBeenCalledTimes(2);
    expect(supervisor.pid('lan')).toBe(2001);
    const order = events.map((event) => event.type);
    expect(order).toEqual(['started', 'exited', 'started']);
    // It exited in time: nothing is killed when the deadline would have passed.
    await vi.advanceTimersByTimeAsync(STOP_DEADLINE_MS);
    expect(signals).toEqual([]);
  });

  it('sends SIGKILL to the stopped child’s own pid at the deadline, and forks the next after its exit', async () => {
    const warn = vi.fn();
    logSupervisor({ supervisor }, { warn, error: vi.fn() });
    supervisor.start(lan);
    supervisor.start(jobs);
    const stopped = supervisor.stop('lan');
    supervisor.start(lan);
    await vi.advanceTimersByTimeAsync(STOP_DEADLINE_MS - 1);
    expect(signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals).toEqual([[2000, 'SIGKILL']]);
    expect(events).toContainEqual({ type: 'kill-escalated', name: 'lan', pid: 2000 });
    expect(warn).toHaveBeenCalledWith('[utility] lan did not exit after SIGTERM; sent SIGKILL to pid 2000');
    // Still only the first lan and jobs: the next lan waits for the exit, not for the signal.
    expect(fork).toHaveBeenCalledTimes(2);

    children[0]?.exit(137);
    await stopped;
    await vi.advanceTimersByTimeAsync(0);
    expect(fork).toHaveBeenCalledTimes(3);
    expect(supervisor.pid('lan')).toBe(2002);
    expect(supervisor.pid('jobs')).toBe(2001);
    expect(signals).toEqual([[2000, 'SIGKILL']]);
  });

  it('a stop while a start waits resolves at the first one’s exit and forks nothing', async () => {
    supervisor.start(lan);
    void supervisor.stop('lan');
    supervisor.start(lan);
    let done = false;
    const again = supervisor.stop('lan').then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(false);
    children[0]?.exit(0);
    await again;
    await vi.advanceTimersByTimeAsync(0);
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('stopAll waits for a child that is still exiting', async () => {
    supervisor.start(lan);
    void supervisor.stop('lan');
    let done = false;
    const all = supervisor.stopAll().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(false);
    children[0]?.exit(0);
    await all;
    expect(done).toBe(true);
  });
});

describe('backoffDelay', () => {
  it('doubles from 250 ms and caps at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((attempt) => backoffDelay(attempt))).toEqual([
      250, 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(backoffDelay(-1)).toBe(250);
  });
});

describe('utilityProcessTable', () => {
  it('lists the PRD 6.1 processes and mcp (P3-V4); agent and jobs start with the app', () => {
    const table = utilityProcessTable('/out/utility/stub.mjs');
    expect(table.map((spec) => [spec.name, spec.eager])).toEqual([
      ['agent', true],
      ['jobs', true],
      ['render', false],
      ['lan', false],
      ['mcp', false],
    ]);
    expect(new Set(table.map((spec) => spec.serviceName)).size).toBe(5);
  });
});
