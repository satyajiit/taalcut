// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, type AppClient, type AsyncResult, type RecoveryReport, type RunId } from '@taalcut/core';

/**
 * Crash recovery as the renderer sees it (P1-D5): core's recovery contract
 * with every call returning a Result. Main builds the report when it opens the
 * library after a crash or a corrupt file; the renderer asks for it once at
 * launch and shows the recovery prompt when it needs attention.
 */
export interface RecoveryClient {
  /** This launch's report. The same report until it is dismissed or resumed. */
  report(): AsyncResult<RecoveryReport>;
  /** Asks the agent to pick these runs up where they stopped. */
  resumeRuns(runIds: readonly RunId[]): AsyncResult<void>;
  /** The user has seen the report: don't offer it again this launch. */
  dismiss(): AsyncResult<void>;
}

/** appContract.recovery, which main serves, as a RecoveryClient. */
export function recoveryClientOverRpc(client: AppClient['recovery']): RecoveryClient {
  return {
    report: () => callRpc(client.report()),
    resumeRuns: (runIds) => callRpc(client.resumeRuns({ runIds: [...runIds] })),
    dismiss: () => callRpc(client.dismiss()),
  };
}

/**
 * A report that arrives while the prompt shows another (main re-offered runs
 * after an agent-process crash): one prompt with both. The newer report wins
 * where they differ; runs and jobs are the union.
 */
export function mergeReports(shown: RecoveryReport, fresh: RecoveryReport): RecoveryReport {
  const runs = new Map([...shown.unfinishedRuns, ...fresh.unfinishedRuns].map((run) => [run.runId, run]));
  const jobs = new Map([...shown.reclaimedJobs, ...fresh.reclaimedJobs].map((job) => [job.id, job]));
  return {
    restoredFromBackup: fresh.restoredFromBackup ?? shown.restoredFromBackup,
    unfinishedRuns: [...runs.values()],
    reclaimedJobs: [...jobs.values()],
    lastCommands: fresh.lastCommands.length > 0 ? fresh.lastCommands : shown.lastCommands,
    needsAttention: shown.needsAttention || fresh.needsAttention,
  };
}
