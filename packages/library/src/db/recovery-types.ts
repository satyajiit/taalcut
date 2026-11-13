// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The crash-recovery report (P1-D5): what the "what was recovered" prompt
 * shows after a restart. Core owns the report's types (its `recovery`
 * contract); the options are the library's.
 */
export type { ProjectCommands, ReclaimedJob, RecoveredCommand, RecoveryReport } from '@taalcut/core';

export interface RecoveryOptions {
  /**
   * Which running jobs go back to the queue (or fail, when out of attempts):
   * 'expired' leases (default, safe in any process), 'all' (only at app start,
   * before any worker runs) or 'none'.
   */
  readonly reclaimJobs?: 'expired' | 'all' | 'none';
  /**
   * With `reclaimJobs: 'all'`: process restarts that give a running job's
   * attempt back (counted in its `interruptions`). Default 2, the jobs
   * engine's own default, so a quit costs what a jobs-process crash costs.
   */
  readonly freeRestarts?: number;
  /** Last commands listed per project. Default 3. */
  readonly commandsPerProject?: number;
  /** Projects listed, most recently changed first. Default 10. */
  readonly projects?: number;
}
