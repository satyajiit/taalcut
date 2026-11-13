// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The external runs a runner holds (P3-V4): each one's held log, its session, the calls in flight and the
 * signal close() aborts. A run the runner doesn't hold yet (after a restart) is held again from the log, as
 * long as it is an external run that hasn't ended.
 */
import { err, ok, type AsyncResult, type RunId } from '@taalcut/core';
import { isTerminal } from '../agent-answer';
import type { ExternalRunHost, HeldRun } from '../agent-types';
import { RunFinished, RunNotFound } from '../errors';
import type { ExternalCallOptions, McpRequester } from './external-types';
import { isExternalRun } from './host';

export interface ExternalRun {
  readonly held: HeldRun;
  readonly sessionId: string;
  /** Aborted by close(): calls in flight see core.cancelled. */
  readonly closing: AbortController;
  readonly inFlight: Set<Promise<unknown>>;
  requester?: McpRequester;
  origin?: ExternalCallOptions['origin'];
}

export interface ExternalRuns {
  get(runId: RunId): ExternalRun | undefined;
  /** Holds a run just started or held from the log; the chat's stop on it calls `onStop`. */
  adopt(runId: RunId, held: HeldRun): ExternalRun;
  /** The run, held again from the log after a restart; an ended or non-external run is refused. */
  attach(runId: RunId): AsyncResult<ExternalRun>;
  /** The run if it can still be held; nothing when it is gone or ended (close() is idempotent). */
  find(runId: RunId): Promise<ExternalRun | undefined>;
  forget(runId: RunId): void;
}

export function createExternalRuns(
  host: Pick<ExternalRunHost, 'hold'>,
  onStop: (runId: RunId) => void,
): ExternalRuns {
  const runs = new Map<RunId, ExternalRun>();

  const adopt = (runId: RunId, held: HeldRun): ExternalRun => {
    const run: ExternalRun = {
      held,
      sessionId: held.log.state.started?.external?.sessionId ?? '',
      closing: new AbortController(),
      inFlight: new Set(),
    };
    runs.set(runId, run);
    // The chat's stop on the run ends the session's run too.
    held.signal.addEventListener('abort', () => onStop(runId), { once: true });
    return run;
  };

  async function attach(runId: RunId): AsyncResult<ExternalRun> {
    const known = runs.get(runId);
    if (known) return ok(known);
    const held = await host.hold(runId);
    if (!held.ok) return held;
    const external = isExternalRun(held.value.log);
    if (external && !isTerminal(held.value.log.state)) return ok(adopt(runId, held.value));
    held.value.release();
    return err(
      external ? RunFinished({ runId }) : RunNotFound({ runId }, { detail: 'Not an external run.' }),
    );
  }

  return {
    get: (runId) => runs.get(runId),
    adopt,
    attach,
    async find(runId) {
      const attached = await attach(runId);
      return attached.ok ? attached.value : undefined;
    },
    forget: (runId) => void runs.delete(runId),
  };
}

/** Runs one call's work as in flight on its run, so close() waits for it. */
export async function inFlight<T>(run: ExternalRun, work: Promise<T>): Promise<T> {
  run.inFlight.add(work);
  try {
    return await work;
  } finally {
    run.inFlight.delete(work);
  }
}

/** A call's signal: the run's close, and the gateway's own (revoke, client cancel) when given. */
export function callSignal(run: ExternalRun, options: Pick<ExternalCallOptions, 'signal'>): AbortSignal {
  return options.signal ? AbortSignal.any([run.closing.signal, options.signal]) : run.closing.signal;
}
