// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How far each of an asset's stages has got beyond its state (LIB1-PROG, core's `stageProgressFields`), for the
 * clip page: the job a queued or running stage runs as, so the page follows its `job.progress` events; the
 * progress that job last saved and when the stage started, while it runs; and how long the stage takes on this Mac
 * (the indexing status's own recent means), so the page can say roughly how long is left.
 */
import type { AssetDetail, JobId } from '@taalcut/core';
import { inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { stageDurations } from '../indexing/status';
import { jobs } from '../schema/jobs';

type Progress = Pick<AssetDetail['stages'][number], 'jobId' | 'progress' | 'startedAt' | 'typicalMs'>;

export interface StageProgressRow {
  readonly stage: string;
  readonly state: string;
  readonly jobId: JobId | null;
  readonly startedAt: number | null;
}

/** Each row's extra fields, by stage; a field is absent where it doesn't apply or isn't known. */
export function stageProgress(
  db: LibraryDatabase,
  rows: readonly StageProgressRow[],
): ReadonlyMap<string, Progress> {
  const durations = stageDurations(db);
  const live = rows.filter(
    (row) => (row.state === 'queued' || row.state === 'running') && row.jobId !== null,
  );
  const running = live.filter((row) => row.state === 'running').map((row) => row.jobId!);
  const saved = new Map(
    running.length === 0
      ? []
      : db.orm
          .select({ id: jobs.id, progress: jobs.progress })
          .from(jobs)
          .where(inArray(jobs.id, running))
          .all()
          .map((job) => [job.id, job.progress]),
  );
  const out = new Map<string, Progress>();
  for (const row of rows) {
    const typical = durations.get(row.stage);
    const fields: Progress = {
      ...(typical !== undefined ? { typicalMs: Math.max(0, Math.round(typical)) } : {}),
    };
    if (live.includes(row)) {
      const progress = row.state === 'running' ? saved.get(row.jobId!) : null;
      Object.assign(fields, {
        jobId: row.jobId!,
        ...(progress != null ? { progress: Math.min(1, Math.max(0, progress)) } : {}),
        ...(row.state === 'running' && row.startedAt !== null ? { startedAt: row.startedAt } : {}),
      });
    }
    out.set(row.stage, fields);
  }
  return out;
}
