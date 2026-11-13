// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Utility processes on their way out. A stopped child gets SIGTERM and its own 2 s grace (runtime.ts
 * exitOnTerminate); one still running at STOP_DEADLINE_MS is wedged and gets SIGKILL, sent to that child's
 * own pid, never by name or pattern. Until its exit, the supervisor forks no other process of its name.
 */

/** The part of a child this needs (supervisor.ts SupervisedChild). */
interface StoppableChild {
  readonly pid: number | undefined;
  kill(): boolean;
}

interface StopTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** A stopped child exits within its 2 s SIGTERM grace; one still running after this is wedged. */
export const STOP_DEADLINE_MS = 5_000;

export interface StopOptions {
  /** Sends `signal` to one pid (process.kill). Only ever a child this supervisor forked, by its own pid. */
  readonly signal?: (pid: number, signal: 'SIGKILL') => void;
  readonly stopDeadlineMs?: number;
}

export class StoppingChildren {
  /** By name: resolves at the exit of the last child of that name that was stopped. */
  private readonly exits = new Map<string, Promise<void>>();

  private readonly deadlineMs: number;
  private readonly signal: (pid: number, signal: 'SIGKILL') => void;

  constructor(
    private readonly timers: StopTimers,
    options: StopOptions,
    private readonly onKill: (name: string, pid: number) => void,
  ) {
    this.deadlineMs = options.stopDeadlineMs ?? STOP_DEADLINE_MS;
    this.signal = options.signal ?? ((pid, signal) => process.kill(pid, signal));
  }

  /** Resolves once no stopped child of `name` is still running (at once when none is). */
  settled(name: string): Promise<void> {
    return this.exits.get(name) ?? Promise.resolve();
  }

  /** Runs `next` now when no stopped child of `name` is still running, else at that child's exit. */
  after(name: string, next: () => void): void {
    const previous = this.exits.get(name);
    if (previous) void previous.then(next);
    else next();
  }

  names(): string[] {
    return [...this.exits.keys()];
  }

  /** SIGTERM now, SIGKILL at the deadline unless `exited` (the child's exit event) came first. */
  stop(name: string, child: StoppableChild, exited: Promise<void>): Promise<void> {
    let gone = false;
    const deadline = this.timers.setTimeout(() => {
      if (!gone) this.kill(name, child);
    }, this.deadlineMs);
    const settled: Promise<void> = exited.then(() => {
      gone = true;
      this.timers.clearTimeout(deadline);
      if (this.exits.get(name) === settled) this.exits.delete(name);
    });
    this.exits.set(name, settled);
    child.kill();
    return settled;
  }

  private kill(name: string, child: StoppableChild): void {
    const pid = child.pid;
    // No pid: it never spawned, and its exit event ends the stop.
    if (pid === undefined) return;
    this.onKill(name, pid);
    try {
      this.signal(pid, 'SIGKILL');
    } catch {
      // ESRCH: it exited after all; its exit event ends the stop.
    }
  }
}
