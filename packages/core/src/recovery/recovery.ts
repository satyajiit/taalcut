// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Crash recovery (P1-D5): the report @taalcut/library builds when it opens
 * the database after a crash or a corrupt file, and appContract.recovery,
 * which main serves (it opens the database) so the renderer can show the
 * "what was recovered" prompt. Resuming runs is forwarded to the agent.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type CommandId, type JobId, type ProjectId } from '../basics/ids';
import { COMMAND_SOURCES, type CommandSource } from '../commands/definition';
import { ipc } from '../ipc/contract';
import { runSummarySchema, type RunSummary } from '../ports/run-log';

export interface BackupRestore {
  /** `missing`: there was no library file, but there were backups. */
  readonly reason: 'corrupt' | 'missing';
  /**
   * Developer detail from the integrity check or the failed open. Main keeps
   * it; recovery.report leaves it out, so a window never gets it.
   */
  readonly detail?: string;
  /** Where the damaged file was moved, or null when nothing was moved. */
  readonly quarantinedPath: string | null;
  readonly restoredFrom: {
    readonly path: string;
    readonly createdAt: number;
    readonly schemaVersion: number;
    readonly reason: string;
  };
}

export interface ReclaimedJob {
  readonly id: JobId;
  readonly kind: string;
  readonly projectId: ProjectId | null;
  /** queued: it will run again from its saved progress; failed: it had no attempts left. */
  readonly state: 'queued' | 'failed';
  /** Saved progress, 0 to 1, or null. */
  readonly progress: number | null;
}

export interface RecoveredCommand {
  readonly id: CommandId;
  readonly name: string;
  readonly sequence: number;
  readonly createdAt: number;
  readonly source: CommandSource;
  readonly actor: string;
  readonly undone: boolean;
}

export interface ProjectCommands {
  /** null for app-wide commands. */
  readonly projectId: ProjectId | null;
  readonly projectName: string | null;
  /** Oldest first; the last one is the last change that was saved. */
  readonly commands: readonly RecoveredCommand[];
}

export interface RecoveryReport {
  /** The library file was corrupt or missing and was replaced by this backup, or null. */
  readonly restoredFromBackup: BackupRestore | null;
  /** Agent runs left running or paused. */
  readonly unfinishedRuns: readonly RunSummary[];
  readonly reclaimedJobs: readonly ReclaimedJob[];
  /** The last committed commands of the most recently changed projects. */
  readonly lastCommands: readonly ProjectCommands[];
  /** A restore, an unfinished run or a reclaimed job: show the prompt. */
  readonly needsAttention: boolean;
}

const count = z.int().nonnegative();
const projectId = idSchema<'Project'>().nullable();

export const recoveryReportSchema = z.object({
  restoredFromBackup: z
    .object({
      reason: z.enum(['corrupt', 'missing']),
      // No `detail`: parsing drops it (see BackupRestore).
      quarantinedPath: z.string().nullable(),
      restoredFrom: z.object({
        path: z.string(),
        createdAt: count,
        schemaVersion: count,
        reason: z.string(),
      }),
    })
    .nullable(),
  unfinishedRuns: z.array(runSummarySchema),
  reclaimedJobs: z.array(
    z.object({
      id: idSchema<'Job'>(),
      kind: z.string(),
      projectId,
      state: z.enum(['queued', 'failed']),
      progress: z.number().min(0).max(1).nullable(),
    }),
  ),
  lastCommands: z.array(
    z.object({
      projectId,
      projectName: z.string().nullable(),
      commands: z.array(
        z.object({
          id: idSchema<'Command'>(),
          name: z.string(),
          sequence: z.int().positive(),
          createdAt: count,
          source: z.enum(COMMAND_SOURCES),
          actor: z.string(),
          undone: z.boolean(),
        }),
      ),
    }),
  ),
  needsAttention: z.boolean(),
});

const runIds = z.object({ runIds: z.array(idSchema<'AgentRun'>()).max(50) });

export const recoveryContract = {
  /** This launch's report. The same report until it is dismissed or runs are resumed. */
  report: ipc.output(recoveryReportSchema),
  /** Asks the agent to pick these runs up where they stopped. */
  resumeRuns: ipc.input(runIds).output(z.void()),
  /** The user has seen the report: don't offer it again this launch. */
  dismiss: ipc.output(z.void()),
};

/** Served by the agent process to main: resume runs a crash left unfinished (recovery.resumeRuns). */
export const agentRunsContract = {
  /** Starts each run again in the background; a run that can't resume is logged, not an error. */
  resume: ipc.input(runIds).output(z.void()),
};
