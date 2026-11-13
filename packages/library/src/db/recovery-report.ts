// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the crash-recovery report (P1-D5) when the database opens: reclaims
 * the jobs a dead process left running, and lists unfinished agent runs and
 * the last committed commands, so the UI can say what was recovered.
 */
import { ok, type ProjectId, type Result } from '@taalcut/core';
import { desc, eq, sql } from 'drizzle-orm';
import { newestCommands } from '../repositories/audit-log';
import { createJobRepository } from '../repositories/jobs';
import { createRunLogRepository } from '../repositories/run-log';
import { projects } from '../schema/chat';
import { commands } from '../schema/audit';
import type { LibraryDatabase } from './database';
import type { BackupRestore } from './recovery';
import type { ProjectCommands, ReclaimedJob, RecoveryOptions, RecoveryReport } from './recovery-types';

const UNFINISHED_RUNS_LISTED = 50;

/** A report with nothing in it but the restore, for databases this version can't inspect (custom migrations). */
export function bareRecoveryReport(restored: BackupRestore | null): RecoveryReport {
  return {
    restoredFromBackup: restored,
    unfinishedRuns: [],
    reclaimedJobs: [],
    lastCommands: [],
    needsAttention: restored !== null,
  };
}

function reclaim(db: LibraryDatabase, options: RecoveryOptions): Result<ReclaimedJob[]> {
  const mode = options.reclaimJobs ?? 'expired';
  if (mode === 'none') return ok([]);
  const repo = createJobRepository(db);
  const reclaimed =
    mode === 'all'
      ? repo.reclaimRunning(options.freeRestarts === undefined ? {} : { freeRestarts: options.freeRestarts })
      : repo.recoverExpiredLeases();
  if (!reclaimed.ok) return reclaimed;
  return ok(
    reclaimed.value.map((job) => ({
      id: job.id,
      kind: job.kind,
      projectId: job.projectId,
      state: job.state === 'failed' ? 'failed' : 'queued',
      progress: job.progress,
    })),
  );
}

function lastCommands(db: LibraryDatabase, projectCount: number, perProject: number): ProjectCommands[] {
  const scopes = db.orm
    .select({
      projectId: commands.projectId,
      name: projects.name,
      last: sql<number>`max(${commands.createdAt})`,
    })
    .from(commands)
    .leftJoin(projects, eq(projects.id, commands.projectId))
    .groupBy(commands.projectId)
    .orderBy(desc(sql`max(${commands.createdAt})`))
    .limit(projectCount)
    .all();
  return scopes.map((scope) => ({
    projectId: scope.projectId as ProjectId | null,
    projectName: scope.name,
    commands: newestCommands(db, scope.projectId, perProject).map((row) => ({
      id: row.id,
      name: row.name,
      sequence: row.seq,
      createdAt: row.createdAt,
      source: row.source,
      actor: row.actor,
      undone: row.status === 'undone',
    })),
  }));
}

export function buildRecoveryReport(
  db: LibraryDatabase,
  restored: BackupRestore | null,
  options: RecoveryOptions = {},
): Result<RecoveryReport> {
  const reclaimedJobs = reclaim(db, options);
  if (!reclaimedJobs.ok) return reclaimedJobs;
  const unfinishedRuns = createRunLogRepository(db).listRuns({
    statuses: ['running', 'paused'],
    limit: UNFINISHED_RUNS_LISTED,
  });
  return ok({
    restoredFromBackup: restored,
    unfinishedRuns,
    reclaimedJobs: reclaimedJobs.value,
    lastCommands: lastCommands(db, options.projects ?? 10, options.commandsPerProject ?? 3),
    needsAttention: restored !== null || unfinishedRuns.length > 0 || reclaimedJobs.value.length > 0,
  });
}
