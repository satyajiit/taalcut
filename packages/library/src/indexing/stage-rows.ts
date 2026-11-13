// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing pipeline's state (P2-L13): one `asset_index_stages` row per
 * asset and stage. All pipeline state is rows, so a quit loses nothing: a
 * restarted pipeline reconciles the rows with their jobs. Every write is
 * synchronous and commits before it returns.
 */
import type {
  AssetId,
  AssetKind,
  JobId,
  JobPriority,
  PublicError,
  SourceId,
  TaalcutError,
} from '@taalcut/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { SqlValue } from '../driver/types';
import { assetIndexStages } from '../schema/media';
import { reopenMilestones } from './milestones';
import { HELD, isModelMissing, MODEL_MISSING_REASON, WAITS_FOR_MODEL } from './model-missing';

export type StageRow = typeof assetIndexStages.$inferSelect;

/** What the pipeline needs to know of a stage to schedule it (from its IndexStageDefinition). */
export interface StagePlan {
  readonly stage: string;
  readonly appliesTo: readonly AssetKind[];
  readonly priority: JobPriority;
  /** Each need with the kinds it applies to: a need that doesn't apply to an asset counts as met. */
  readonly needs: readonly { readonly stage: string; readonly appliesTo: readonly AssetKind[] }[];
  /**
   * Each optional read (LRN1-CTX) with the kinds it applies to and its `blockers`: it and every stage it needs,
   * transitively. It is waited for like a need until it can't come now: a blocker's row failed or won't run until
   * its model is there.
   */
  readonly optionalReads: readonly OptionalReadPlan[];
}

export interface OptionalReadPlan {
  readonly stage: string;
  readonly appliesTo: readonly AssetKind[];
  readonly blockers: readonly string[];
}

/** A waiting stage whose needs are met and whose original is present. */
export interface RunnableStage {
  readonly assetId: AssetId;
  readonly generation: number;
  readonly kind: AssetKind;
  readonly attempts: number;
  /** Someone waits for the asset until then (null: nobody). */
  readonly boostedUntil: number | null;
  /**
   * The asset's place in import order: its rowid in `assets`, which grows with every insert (one scan
   * batch shares one `created_at`, so that can't order the files in it). The feed's order key.
   */
  readonly importOrder: number;
}

export const PRIORITY_VALUE: Readonly<Record<JobPriority, number>> = { low: -1, normal: 0, high: 1 };

export function priorityName(value: number): JobPriority {
  return value > 0 ? 'high' : value < 0 ? 'low' : 'normal';
}

/** The original is offline, missing or an iCloud placeholder: the stage waits until it is back. */
export const ORIGINAL_OFFLINE = 'library.stage.originalOffline';

/** The stage's on-device model isn't installed yet: it waits, and runs once the model is there. */
export const MODEL_MISSING = MODEL_MISSING_REASON;

/** The stage that identifies the bytes; every other stage needs it, and a re-index keeps it. */
export const HASH_STAGE = 'library.hash';

/** A job output is kept for later stages only while it fits the column's 1 MiB. */
export const MAX_OUTPUT_BYTES = 1_048_576;

const PRESENT = `EXISTS (SELECT 1 FROM asset_locations l WHERE l.asset_id = x.asset_id AND l.state = 'present')`;
const kinds = (list: readonly AssetKind[]) => JSON.stringify(list);

/** An error as a window may see it (rows are read by the asset page). */
export function publicError(error: TaalcutError): PublicError {
  const { detail: _detail, ...rest } = error;
  return rest;
}

/** The output to keep, or null when it is too large to store. */
export function storableOutput(output: unknown): unknown {
  if (output === undefined) return null;
  const text = JSON.stringify(output);
  return text !== undefined && Buffer.byteLength(text) <= MAX_OUTPUT_BYTES ? output : null;
}

export type StageRows = ReturnType<typeof createStageRows>;

/**
 * Back to waiting (a re-index): these stages, or every stage after library.hash. The generation the row waits for
 * is the asset's; a job still running reports for an older one and its result is dropped.
 */
function resetRows(
  db: LibraryDatabase,
  assetIds: readonly AssetId[],
  stages?: readonly string[],
  priority?: JobPriority,
): number {
  if (assetIds.length === 0) return 0;
  const which = stages ? 'x.stage IN (SELECT value FROM json_each(?))' : 'x.stage <> ?';
  const ids = JSON.stringify(assetIds);
  const chosen = stages ? JSON.stringify(stages) : HASH_STAGE;
  return db.transaction(() => {
    const changed = db.driver
      .prepare(
        `UPDATE asset_index_stages AS x SET state = 'waiting', job_id = NULL, error = NULL, reason_key = NULL,
         output = NULL, started_at = NULL, finished_at = NULL, attempts = 0, updated_at = ?,
         generation = (SELECT generation FROM assets WHERE id = x.asset_id)
         ${priority ? ', priority = ?' : ''}
       WHERE x.asset_id IN (SELECT value FROM json_each(?)) AND ${which}`,
      )
      .run(db.clock(), ...(priority ? [PRIORITY_VALUE[priority]] : []), ids, chosen).changes;
    reopenMilestones(db, ids, { which, chosen });
    return changed;
  });
}

/** Met: the stage doesn't apply to the asset's kind, or its row is done or skipped. Two `?`: the kinds, the stage. */
const MET = `a.kind NOT IN (SELECT value FROM json_each(?)) OR EXISTS (
    SELECT 1 FROM asset_index_stages n WHERE n.asset_id = x.asset_id AND n.stage = ?
      AND n.state IN ('done', 'skipped'))`;
/** An optional read can't come now: a blocker's row failed or waits for its model. Two `?`: blockers, reason. */
const CANNOT_COME = `EXISTS (SELECT 1 FROM asset_index_stages b WHERE b.asset_id = x.asset_id
    AND b.stage IN (SELECT value FROM json_each(?)) AND (b.state = 'failed' OR ${WAITS_FOR_MODEL}))`;

/** `runnable`'s conditions on the plan's needs and optional reads (LRN1-CTX), with their parameters. */
function readiness(plan: StagePlan): { sql: string; params: SqlValue[] } {
  const needs = plan.needs.map(() => `AND (${MET})`);
  // An optional read is met like a need, or once it can't come now.
  const optional = plan.optionalReads.map(() => `AND (${MET} OR ${CANNOT_COME})`);
  return {
    sql: [...needs, ...optional].join(' '),
    params: [
      ...plan.needs.flatMap((n) => [kinds(n.appliesTo), n.stage]),
      ...plan.optionalReads.flatMap((r) => [
        kinds(r.appliesTo),
        r.stage,
        JSON.stringify(r.blockers),
        MODEL_MISSING,
      ]),
    ],
  };
}

export function createStageRows(db: LibraryDatabase) {
  const { orm } = db;
  const run = (text: string, ...params: SqlValue[]) => db.driver.prepare(text).run(...params).changes;
  const key = (assetId: AssetId, stage: string) =>
    and(eq(assetIndexStages.assetId, assetId), eq(assetIndexStages.stage, stage));
  const set = (assetId: AssetId, stage: string, changes: Partial<StageRow>) =>
    orm
      .update(assetIndexStages)
      .set({ ...changes, updatedAt: db.clock() })
      .where(key(assetId, stage))
      .run().changes;

  return {
    get: (assetId: AssetId, stage: string): StageRow | undefined =>
      orm.select().from(assetIndexStages).where(key(assetId, stage)).get(),
    byJob: (jobId: JobId): StageRow | undefined =>
      orm.select().from(assetIndexStages).where(eq(assetIndexStages.jobId, jobId)).get(),
    listByAsset: (assetId: AssetId): StageRow[] =>
      orm
        .select()
        .from(assetIndexStages)
        .where(eq(assetIndexStages.assetId, assetId))
        .orderBy(asc(assetIndexStages.stage))
        .all(),
    /** Rows whose job the pipeline follows. */
    active: (): StageRow[] =>
      orm
        .select()
        .from(assetIndexStages)
        .where(inArray(assetIndexStages.state, ['queued', 'running']))
        .all(),

    /**
     * Adds a `waiting` row for every asset the stage applies to that has none (all assets, or those
     * created or changed since `since`). Writers need not know the stages: a new stage needs no writer change.
     */
    seed(plan: StagePlan, since?: number): number {
      const recent = since === undefined ? '' : 'AND (a.created_at >= ? OR a.updated_at >= ?)';
      const params: SqlValue[] = since === undefined ? [] : [since, since];
      return run(
        `INSERT INTO asset_index_stages (asset_id, stage, state, generation, priority, updated_at)
         SELECT a.id, ?, 'waiting', a.generation, ?, ? FROM assets a
         WHERE a.kind IN (SELECT value FROM json_each(?)) AND a.trashed_at IS NULL ${recent}
           AND NOT EXISTS (SELECT 1 FROM asset_index_stages x WHERE x.asset_id = a.id AND x.stage = ?)`,
        plan.stage,
        PRIORITY_VALUE[plan.priority],
        db.clock(),
        kinds(plan.appliesTo),
        ...params,
        plan.stage,
      );
    },

    /**
     * Waiting rows of `plan.stage` whose needs are met (done or skipped, or not applying to the asset's
     * kind) and whose original is present: who waits first (boosted, then priority), then import order.
     * Rows held for their model (model-wait.ts) are left out; `held` asks for those alone, longest held first.
     */
    runnable(plan: StagePlan, limit: number, held = false): RunnableStage[] {
      const now = db.clock();
      const ready = readiness(plan);
      const order = held
        ? 'x.updated_at ASC, a.rowid ASC'
        : `(CASE WHEN coalesce(x.boosted_until, 0) > ? THEN 1 ELSE x.priority END) DESC,
             x.boosted_until DESC, a.rowid ASC`;
      return db.driver
        .prepare(
          `SELECT x.asset_id AS assetId, a.generation AS generation, a.kind AS kind, x.attempts AS attempts,
             x.boosted_until AS boostedUntil, a.rowid AS importOrder
           FROM asset_index_stages x JOIN assets a ON a.id = x.asset_id
           WHERE x.stage = ? AND x.state = 'waiting' AND ${held ? '' : 'NOT'} ${HELD}
             AND a.trashed_at IS NULL AND ${PRESENT} ${ready.sql}
           ORDER BY ${order}
           LIMIT ?`,
        )
        .all(
          plan.stage,
          MODEL_MISSING,
          ...ready.params,
          ...(held ? [] : [now]),
          limit,
        ) as unknown as RunnableStage[];
    },

    /** A stage that can't run yet: its waiting rows (the original present) get the reason. */
    markBlocked(stage: string, reasonKey: string): number {
      return run(
        `UPDATE asset_index_stages AS x SET reason_key = ?, updated_at = ?
         WHERE x.stage = ? AND x.state = 'waiting' AND x.reason_key IS NULL`,
        reasonKey,
        db.clock(),
        stage,
      );
    },

    /** Waiting rows whose original isn't present get the reason the asset page shows. */
    markOffline(): number {
      return run(
        `UPDATE asset_index_stages AS x SET reason_key = ?, updated_at = ?
         WHERE x.state = 'waiting' AND x.reason_key IS NOT ? AND NOT ${PRESENT}`,
        ORIGINAL_OFFLINE,
        db.clock(),
        ORIGINAL_OFFLINE,
      );
    },

    queuedCount: (stage: string): number =>
      Number(
        db.driver
          .prepare(`SELECT COUNT(*) AS n FROM asset_index_stages WHERE stage = ? AND state = 'queued'`)
          .get(stage)?.n ?? 0,
      ),

    queued(
      assetId: AssetId,
      stage: string,
      job: { jobId: JobId; version: number; generation: number; priority: JobPriority },
    ) {
      return set(assetId, stage, {
        state: 'queued',
        jobId: job.jobId,
        version: job.version,
        generation: job.generation,
        priority: PRIORITY_VALUE[job.priority],
        reasonKey: null,
        error: null,
        attempts: sql`${assetIndexStages.attempts} + 1` as unknown as number,
      });
    },
    /** `at`: when the job started (the job event's time), for the benchmark's durations. */
    running: (assetId: AssetId, stage: string, at = db.clock()) =>
      set(assetId, stage, { state: 'running', startedAt: at, finishedAt: null }),
    /** Back in the queue (a retry after a retryable failure): still the same job. */
    requeued: (assetId: AssetId, stage: string) => set(assetId, stage, { state: 'queued' }),
    waiting: (assetId: AssetId, stage: string, reasonKey: string | null = null) =>
      set(assetId, stage, { state: 'waiting', jobId: null, reasonKey }),
    skipped: (assetId: AssetId, stage: string, reasonKey: string, version: number, generation: number) =>
      set(assetId, stage, {
        state: 'skipped',
        jobId: null,
        reasonKey,
        version,
        generation,
        error: null,
        finishedAt: db.clock(),
      }),
    /**
     * The job failed. A missing on-device model isn't the file's failure (model-missing.ts): the row is held,
     * waiting for the model with its reason and the error that names it.
     */
    failed: (assetId: AssetId, stage: string, error: TaalcutError, at = db.clock()) =>
      isModelMissing(error)
        ? set(assetId, stage, {
            state: 'waiting',
            jobId: null,
            reasonKey: MODEL_MISSING,
            error: publicError(error),
            finishedAt: at,
          })
        : set(assetId, stage, { state: 'failed', error: publicError(error), finishedAt: at }),
    done: (assetId: AssetId, stage: string, output: unknown, at = db.clock()) =>
      set(assetId, stage, {
        state: 'done',
        output: storableOutput(output),
        error: null,
        reasonKey: null,
        finishedAt: at,
      }),

    reset: (assetIds: readonly AssetId[], stages?: readonly string[], priority?: JobPriority): number =>
      resetRows(db, assetIds, stages, priority),

    /**
     * `reset` for the asset's rows of `stages` that have left `waiting` (done, skipped, failed, queued or running):
     * an optional read stored something after its reader ran (LRN1-CTX). A waiting reader reads it when it runs.
     */
    resetStarted(assetId: AssetId, stages: readonly string[]): number {
      const started = (
        db.driver
          .prepare(
            `SELECT stage FROM asset_index_stages WHERE asset_id = ? AND state <> 'waiting'
               AND stage IN (SELECT value FROM json_each(?))`,
          )
          .all(assetId, JSON.stringify(stages)) as { stage: string }[]
      ).map((row) => row.stage);
      return started.length > 0 ? resetRows(db, [assetId], started) : 0;
    },

    /** Finished rows an older version of the stage produced (a definition's version rose). */
    outdated: (stage: string, version: number, limit: number): AssetId[] =>
      (
        db.driver
          .prepare(
            `SELECT asset_id AS id FROM asset_index_stages
             WHERE stage = ? AND state IN ('done', 'skipped') AND version < ? LIMIT ?`,
          )
          .all(stage, version, limit) as { id: AssetId }[]
      ).map((r) => r.id),

    /** Someone waits for these assets until `until`: their waiting and queued stages go first. */
    boost(assetIds: readonly AssetId[], until: number): number {
      return run(
        `UPDATE asset_index_stages SET boosted_until = ?, updated_at = ?
         WHERE asset_id IN (SELECT value FROM json_each(?)) AND state IN ('waiting', 'queued', 'running')`,
        until,
        db.clock(),
        JSON.stringify(assetIds),
      );
    },

    /**
     * Failed rows back to waiting (all, or one source's assets), and rows that wait for their model released to try
     * again (model-wait.ts): Try again means now. That includes the rows blocked behind held ones, as a release
     * does, so an optional read of them is waited for again at once (LRN1-CTX). Returns how many.
     */
    retryFailed(sourceId?: SourceId): number {
      const scope = sourceId
        ? 'AND x.asset_id IN (SELECT asset_id FROM asset_locations WHERE source_id = ?)'
        : '';
      return run(
        `UPDATE asset_index_stages AS x SET state = 'waiting', job_id = NULL, error = NULL, reason_key = NULL,
           attempts = 0, updated_at = ? WHERE (x.state = 'failed' OR (x.state = 'waiting' AND x.reason_key IS ?))
           ${scope}`,
        db.clock(),
        MODEL_MISSING,
        ...(sourceId ? [sourceId] : []),
      );
    },
  };
}
