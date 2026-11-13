// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What an agent lends the external runner (P3-V4): its runs' logs, so an external run's events reach the same
 * feed, traces and cards as the agent's own, and an answer given in the chat writes to the very log the runner
 * holds; and what the runner's executor is built from (the agent's dependencies, consents and costs). A held
 * run has no model loop: its "drive" is the hold, which ends when the runner lets go, and the agent's cancel
 * aborts the hold's signal so the runner closes the run.
 */
import { ok, type AsyncResult, type Result, type RunId } from '@taalcut/core';
import type { AgentDeps, AgentFeedEvent, ExternalRunHost, HeldRun } from '../agent-types';
import type { Phase2Context } from '../context';
import type { ConsentStore } from '../ports';
import { RunLog, type LogListener } from '../run-log';

/** A run as the agent keeps it (agent.ts's ActiveRun). */
export interface HostedRun {
  readonly log: RunLog;
  controller: AbortController;
  drive?: Promise<Result<void>>;
}

export interface ExternalHostDeps {
  readonly deps: AgentDeps;
  readonly runs: Map<RunId, HostedRun>;
  /** The agent's open(): the cached run while one is held, else read again from the store. */
  readonly open: (runId: RunId) => AsyncResult<HostedRun>;
  readonly onLogEvent: LogListener;
  readonly consents: ConsentStore;
  readonly phase2: Phase2Context;
  readonly now: () => number;
  readonly subscribe: (listener: (event: AgentFeedEvent) => void) => () => void;
}

export function createExternalHost(input: ExternalHostDeps): ExternalRunHost {
  const holds = new Map<RunId, () => void>();

  const held = (runId: RunId, run: HostedRun): HeldRun => {
    if (!run.drive) {
      if (run.controller.signal.aborted) run.controller = new AbortController();
      run.drive = new Promise<Result<void>>((resolve) => holds.set(runId, () => resolve(ok(undefined))));
    }
    return {
      log: run.log,
      signal: run.controller.signal,
      release() {
        holds.get(runId)?.();
        holds.delete(runId);
        run.drive = undefined;
      },
    };
  };

  return {
    deps: input.deps,
    consents: input.consents,
    phase2: input.phase2,
    now: input.now,
    async start(runId, started) {
      const log = await RunLog.open(input.deps.log, runId, input.now, input.onLogEvent);
      if (!log.ok) return log;
      const written = await log.value.append(
        ['run.started', started],
        ['run.paused', { reason: 'external', requestIds: [] }],
      );
      if (!written.ok) return written;
      const run: HostedRun = { log: log.value, controller: new AbortController() };
      input.runs.set(runId, run);
      return ok(held(runId, run));
    },
    async hold(runId) {
      const run = await input.open(runId);
      return run.ok ? ok(held(runId, run.value)) : run;
    },
    subscribe: input.subscribe,
  };
}

/** A run an external agent drives: never driven by the loop, resumed or recovered by the agent. */
export function isExternalRun(log: RunLog): boolean {
  return log.state.started?.external !== undefined;
}
