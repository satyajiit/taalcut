// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How a confined child is ended (IX3-K2), by core's `planProcessEnd`: SIGTERM to its group, then SIGKILL after the
 * grace; a run that may hold a hardware video session (the sandbox's FFmpeg) gets one SIGTERM, is answered after two
 * graces while it is left to exit, and is reported once as a stall. Never a SIGKILL for it, on any path.
 */
import type { ChildProcess } from 'node:child_process';
import {
  PLAIN_STOP,
  planProcessEnd,
  scheduleEnd,
  stallLine,
  type ProcessStall,
  type ProgramStop,
} from '@taalcut/core';

export const KILL_GRACE_MS = 2000;

/** What ending a child needs from its run (runner.ts's `ConfinedRun`). */
export interface EndingRun {
  readonly program: string;
  readonly args: readonly string[];
  readonly holdsVideoSession?: boolean;
  readonly stop?: ProgramStop;
}

/** What ending a child needs from the caller (runner.ts's `ConfinedOptions`). */
export interface EndingOptions {
  readonly onOutlive?: (exited: Promise<void>) => void;
  readonly onStall?: (stall: ProcessStall) => void;
  readonly stallAfterMs?: number;
}

export interface ConfinedEnd {
  /** Starts ending the child, once. */
  stop(reason: 'wall' | 'disk' | 'abort'): void;
  /** Why it was stopped, or null. */
  readonly reason: 'wall' | 'disk' | 'abort' | null;
  /** The run was answered: a child that may be killed needs no more steps (one left running keeps its stall). */
  answered(): void;
}

const logStall = (stall: ProcessStall) => console.warn(`[tools] sandbox ${stallLine(stall)}`);

/** Ends `child` when told to; `release` answers the run while a video-session child is left running. */
export function confinedEnd(
  child: ChildProcess,
  run: EndingRun,
  options: EndingOptions,
  release: () => void,
): ConfinedEnd {
  const holding = { holdsVideoSession: run.holdsVideoSession === true };
  const plan = planProcessEnd(holding, run.stop ?? PLAIN_STOP, KILL_GRACE_MS, options.stallAfterMs);
  const timers = new Set<NodeJS.Timeout>();
  const clear = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  let exited = false;
  const exit = new Promise<void>((resolve) =>
    child.once('exit', () => {
      exited = true;
      // A child that may be killed keeps its SIGKILL for a grandchild holding the pipes, until they close.
      if (!plan.mayKill) clear();
      resolve();
    }),
  );
  const killGroup = (signal: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    } catch {
      // Already gone.
    }
  };
  const later = (ms: number, step: () => void) => {
    if (ms === 0) return step();
    const timer = setTimeout(() => {
      timers.delete(timer);
      step();
    }, ms);
    // A child left running never keeps this process alive.
    if (!plan.mayKill) timer.unref();
    timers.add(timer);
  };
  let reason: ConfinedEnd['reason'] = null;
  const handlers = {
    // Its stdin is closed: nothing to ask through.
    ask: () => undefined,
    terminate: () => {
      if (!exited || plan.mayKill) killGroup('SIGTERM');
    },
    kill: () => killGroup('SIGKILL'),
    release: () => {
      if (exited) return;
      options.onOutlive?.(exit);
      release();
    },
    stall: ({ afterMs }: { readonly afterMs: number }) => {
      if (exited || reason === null) return;
      (options.onStall ?? logStall)({
        pid: child.pid,
        command: run.program,
        args: run.args,
        reason,
        afterMs,
      });
    },
  };
  return {
    stop(why) {
      if (reason) return;
      reason = why;
      scheduleEnd(plan, handlers, later);
    },
    get reason() {
      return reason;
    },
    answered() {
      if (plan.mayKill) clear();
    },
  };
}
