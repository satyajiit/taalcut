// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the JSON-lines client ends its helper process (json-line.ts), by the end policy (process/end-policy.ts,
 * IX3-K2). A helper that may hold hardware video sessions (the mac helper's decode, grade and track services) is
 * only asked: its stdin ends, it finishes its work and exits; it has no SIGTERM handler, so it is never signalled,
 * and one that hasn't exited after the stall grace is reported once and left running. Any other helper gets
 * SIGTERM, then SIGKILL after the grace.
 */
import type { ChildProcess } from 'node:child_process';
import { signalGroup } from '../process/child-group';
import { HELPER_STOP, scheduleEnd, type EndPolicy, type RunHolding } from '../process/end-policy';

export interface HelperEnd {
  readonly policy: EndPolicy;
  readonly holding: RunHolding;
  /** Between the steps: a second for `close()`, none for a process the client gave up on. */
  readonly graceMs: number;
  /** Why it is being ended (`closed`, `abandoned`), for a stall report. */
  readonly reason: string;
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Ends `proc`. Resolves when it has closed, when it was SIGKILLed, or when it was reported as a stall (it is then
 * left running, and what the client tracks for it is let go only at its exit).
 */
export function endHelper(proc: ChildProcess, end: HelperEnd): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timers = new Set<NodeJS.Timeout>();
    const finish = (): void => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      resolve();
    };
    proc.once('close', finish);
    const plan = end.policy.plan(end.holding, HELPER_STOP, end.graceMs);
    scheduleEnd(
      plan,
      {
        ask: () => proc.stdin?.end(),
        terminate: () => signalGroup(proc, 'SIGTERM'),
        kill: () => {
          signalGroup(proc, 'SIGKILL');
          finish();
        },
        // close() waits for the exit or the stall report, not for the runner's prompt release.
        release: () => undefined,
        stall: (step) => {
          end.policy.stalled({
            pid: proc.pid,
            command: end.command,
            args: end.args,
            reason: end.reason,
            afterMs: step.afterMs,
          });
          finish();
        },
      },
      (ms, run) => {
        if (ms === 0) {
          run();
          return;
        }
        const timer = setTimeout(() => {
          timers.delete(timer);
          run();
        }, ms);
        // The steps never keep this process alive on their own.
        timer.unref();
        timers.add(timer);
      },
    );
  });
}
