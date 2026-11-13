// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keeps utility processes running (P1-B2). Forks each one, notices when it
 * exits without being asked to, and forks it again after a backoff delay.
 * Electron is injected (fork), so the restart logic is unit-tested with fakes.
 *
 * Listeners get an 'exited' event for every exit; UtilityHost uses it to
 * close that process's connection as 'peer-exited', so its in-flight calls
 * reject with core.process_restarted.
 *
 * One process per name at a time: a start while the last one of that name
 * is still exiting forks only after its exit, since both would own the same
 * files (a USB run file, the LAN server's state). stopping.ts ends a stopped
 * child: SIGTERM, then SIGKILL to its own pid if it outlives the deadline.
 */
import { backoffDelay, DEFAULT_BACKOFF, type BackoffPolicy } from './backoff';
import { StoppingChildren, type StopOptions } from './stopping';

export interface ProcessSpec {
  /** Stable name used in events and errors: 'agent', 'jobs', 'render', 'lan'. */
  readonly name: string;
  /** Bundled entry module (out/utility/*.mjs). */
  readonly modulePath: string;
  /** Shown in Activity Monitor and app.getAppMetrics(). */
  readonly serviceName: string;
}

/** The part of Electron's UtilityProcess the supervisor uses. */
export interface SupervisedChild {
  readonly pid: number | undefined;
  kill(): boolean;
  once(event: 'exit', listener: (code: number) => void): unknown;
}

export type ForkProcess = (spec: ProcessSpec) => SupervisedChild;

export type SupervisorEvent =
  | { readonly type: 'started'; readonly name: string; readonly restarts: number }
  | { readonly type: 'exited'; readonly name: string; readonly code: number; readonly expected: boolean }
  | {
      readonly type: 'restart-scheduled';
      readonly name: string;
      readonly delayMs: number;
      readonly attempt: number;
    }
  | { readonly type: 'spawn-failed'; readonly name: string; readonly detail: string }
  | { readonly type: 'kill-escalated'; readonly name: string; readonly pid: number };

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SupervisorOptions extends StopOptions {
  readonly fork: ForkProcess;
  readonly backoff?: BackoffPolicy;
  readonly now?: () => number;
  readonly timers?: Timers;
}

interface Entry {
  readonly spec: ProcessSpec;
  child: SupervisedChild | undefined;
  startedAt: number;
  /** Position in the current crash streak; picks the backoff delay. */
  attempt: number;
  restarts: number;
  timer: unknown;
  stopping: boolean;
  exitWaiters: (() => void)[];
}

const realTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class ProcessSupervisor {
  private readonly entries = new Map<string, Entry>();
  private readonly stopping: StoppingChildren;
  private readonly listeners = new Set<(event: SupervisorEvent) => void>();
  private readonly backoff: BackoffPolicy;
  private readonly now: () => number;
  private readonly timers: Timers;

  constructor(private readonly options: SupervisorOptions) {
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? realTimers;
    this.stopping = new StoppingChildren(this.timers, options, (name, pid) =>
      this.emit({ type: 'kill-escalated', name, pid }),
    );
  }

  /** Starts a process and keeps it running until stop(). Starting a running process does nothing. */
  start(spec: ProcessSpec): void {
    const existing = this.entries.get(spec.name);
    if (existing && !existing.stopping) return;
    const entry: Entry = {
      spec,
      child: undefined,
      startedAt: 0,
      attempt: 0,
      restarts: 0,
      timer: undefined,
      stopping: false,
      exitWaiters: [],
    };
    this.entries.set(spec.name, entry);
    this.stopping.after(spec.name, () => {
      if (!entry.stopping) this.spawn(entry);
    });
  }

  /** Stops a process for good (no restart) and resolves once it, and any earlier one of its name, has exited. */
  stop(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) return this.stopping.settled(name);
    entry.stopping = true;
    this.entries.delete(name);
    if (entry.timer !== undefined) {
      this.timers.clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    const child = entry.child;
    if (!child) return this.stopping.settled(name);
    return this.stopping.stop(name, child, new Promise((resolve) => entry.exitWaiters.push(resolve)));
  }

  stopAll(): Promise<void> {
    const names = new Set([...this.entries.keys(), ...this.stopping.names()]);
    return Promise.all([...names].map((name) => this.stop(name))).then(() => undefined);
  }

  pid(name: string): number | undefined {
    return this.entries.get(name)?.child?.pid;
  }

  isRunning(name: string): boolean {
    return this.entries.get(name)?.child !== undefined;
  }

  on(listener: (event: SupervisorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private spawn(entry: Entry): void {
    let child: SupervisedChild;
    try {
      child = this.options.fork(entry.spec);
    } catch (cause) {
      this.emit({ type: 'spawn-failed', name: entry.spec.name, detail: String(cause) });
      this.scheduleRestart(entry);
      return;
    }
    entry.child = child;
    entry.startedAt = this.now();
    child.once('exit', (code) => this.onExit(entry, child, code));
    this.emit({ type: 'started', name: entry.spec.name, restarts: entry.restarts });
  }

  private onExit(entry: Entry, child: SupervisedChild, code: number): void {
    if (entry.child !== child) return;
    entry.child = undefined;
    this.emit({ type: 'exited', name: entry.spec.name, code, expected: entry.stopping });
    if (entry.stopping) {
      for (const resolve of entry.exitWaiters.splice(0)) resolve();
      return;
    }
    if (this.now() - entry.startedAt >= this.backoff.stableAfterMs) entry.attempt = 0;
    this.scheduleRestart(entry);
  }

  private scheduleRestart(entry: Entry): void {
    const delayMs = backoffDelay(entry.attempt, this.backoff);
    this.emit({ type: 'restart-scheduled', name: entry.spec.name, delayMs, attempt: entry.attempt });
    entry.attempt += 1;
    entry.timer = this.timers.setTimeout(() => {
      entry.timer = undefined;
      if (entry.stopping) return;
      entry.restarts += 1;
      this.spawn(entry);
    }, delayMs);
  }

  private emit(event: SupervisorEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
