// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A breakdown's scratch goes on every path only if a failed discard is never
 * taken for success (P2-T3). An experiment that is already gone counts as
 * discarded; anything else that stops the discard is the caller's to report.
 * A reel a template keeps (REF1) has left scratch before its experiment goes.
 */
import {
  NotFoundError,
  ok,
  type AsyncResult,
  type ExperimentId,
  type ExperimentSandbox,
  type Result,
  type TaalcutError,
} from '@taalcut/core';

/** The real sandbox's "no such experiment" (@taalcut/tools); test sandboxes use core's not-found. */
const GONE = 'sandbox.experiment_not_found';

export function isGone(error: TaalcutError): boolean {
  return error.code === GONE || NotFoundError.is(error);
}

/** Discards the experiment; one that is already gone frees 0 bytes. Other errors come back as they are. */
export async function discardExperiment(
  sandbox: Pick<ExperimentSandbox, 'discard'>,
  id: ExperimentId,
): AsyncResult<{ readonly freedBytes: number }> {
  const discarded = await sandbox.discard(id);
  if (discarded.ok || !isGone(discarded.error)) return discarded;
  return ok({ freedBytes: 0 });
}

/** The first failure, with a discard that also failed named in its detail (for the trace and the agent). */
export function withDiscard(error: TaalcutError, discarded: Result<unknown>): TaalcutError {
  if (discarded.ok) return error;
  const note = `scratch not discarded: ${discarded.error.code}`;
  return { ...error, detail: error.detail ? `${error.detail}; ${note}` : note };
}
