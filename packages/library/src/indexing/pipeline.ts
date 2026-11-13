// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing pipeline (P2-L13), in the jobs process: stages are data
 * (core's IndexStageDefinition, registered by the packages that own the
 * work), dependent jobs run through the job queue, and every bit of state is
 * a row, so quitting mid-index resumes where it stopped.
 *
 * It seeds a `waiting` row for each stage an asset lacks, feeds runnable
 * stages to the queue by asset (who waits first, then import order; each job
 * carries its asset's import order as its order key, so indexing goes
 * depth-first: feed-order.ts; at most 64 queued per stage, so a 50,000-file
 * folder never floods the jobs table),
 * follows its jobs' `job.stateChanged` to store results, and polls every
 * second for rows other processes wrote. Work is serialised: one step at a
 * time, so rows and jobs never race inside this process.
 */
import {
  CancelledError,
  isTerminalJobState,
  toTaalcutError,
  type AssetId,
  type EventBus,
  type IndexStageDefinition,
  type JobId,
  type JobQueue,
  type JobSnapshot,
  type JobState,
  type TaalcutError,
  type VectorIndex,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createCacheHolds } from './cache-holds';
import { createEvictedFiles } from './evicted-files';
import { byFeedOrder, importOrderKey, type FeedCandidate } from './feed-order';
import { createInvalidation, type Invalidation } from './invalidation';
import { createModelWait } from './model-wait';
import { skippingProvidedSpeech } from './provided-transcript';
import { createStageOutcomes } from './stage-outcomes';
import { checkStageReads } from './stage-reads';
import { orderStages, stagePlan } from './stage-plan';
import { createStageRows, type RunnableStage, type StagePlan, type StageRow } from './stage-rows';
import { buildAssetIndexView } from './view';

export interface PipelineCoreDeps {
  readonly db: LibraryDatabase;
  readonly queue: JobQueue;
  readonly events: EventBus;
  readonly stages: readonly IndexStageDefinition[];
  readonly now: () => number;
  /** At most this many queued jobs per stage. Default 64. */
  readonly maxQueuedPerStage?: number;
  readonly log?: (message: string) => void;
  /**
   * A stage finished (the duplicates pass and the status event listen); `stored` names the asset when its
   * result was stored, so what the Library shows of it changed.
   */
  readonly onSettled?: (stage: string, stored?: AssetId) => void;
  /**
   * A reason (i18n key) while a stage can't run at all, e.g. its on-device model isn't installed: its rows
   * stay `waiting` with that reason instead of failing, and run once it clears (asked on every feed).
   */
  readonly notReady?: (stage: string) => string | undefined;
  /** The active embedding space's index, once there is one: a skip's `clears` removes the asset's vectors there. */
  readonly vectors?: (() => VectorIndex | undefined) | undefined;
  /** How often a stage held for its model tries one row again (model-wait.ts). Default 5 minutes. */
  readonly modelProbeMs?: number;
}

const guard = <T>(fn: () => T): { ok: true; value: T } | { ok: false; error: TaalcutError } => {
  try {
    return { ok: true, value: fn() };
  } catch (cause) {
    return { ok: false, error: toTaalcutError(cause) };
  }
};

/**
 * When the queue is idle: rows an older definition version produced go back, at low priority. Their assets'
 * digests are recorded first (an old library has none), so the re-run's changes reach the stages that read them,
 * and then a few more of an old library's (round IX3: nothing re-runs for those). Returns how many rows went back.
 */
function resetOutdated(
  rows: ReturnType<typeof createStageRows>,
  ordered: readonly IndexStageDefinition[],
  invalidation: Invalidation,
  limit: number,
): number {
  let reset = 0;
  for (const definition of ordered) {
    const ids = rows.outdated(definition.stage, definition.version, limit);
    if (ids.length === 0) continue;
    invalidation.backfill(ids);
    reset += rows.reset(ids, [definition.stage], 'low');
  }
  invalidation.backfillSome();
  return reset;
}

/**
 * Seeding, feeding and settling, by the stage graph's plans (stage-plan.ts); control (pause, boost, status) is in
 * indexing-pipeline.ts.
 */
export function createPipelineCore(deps: PipelineCoreDeps) {
  const { db, queue } = deps;
  const rows = createStageRows(db);
  const ordered = orderStages(deps.stages);
  checkStageReads(ordered);
  const plans = ordered.map((s) => stagePlan(s, ordered));
  const definitions = new Map(ordered.map((s) => [s.stage, skippingProvidedSpeech(db, s)]));
  // Dependent invalidation (round IX3): what each stage stores, and the stages that read it.
  const invalidation = createInvalidation({ db, stages: ordered });
  const outcomes = createStageOutcomes({ db, invalidation, vectors: deps.vectors });
  const modelWait = createModelWait(db, rows, deps.modelProbeMs);
  // What the media cache may evict, and the stages whose file it let go (UX2: cache-holds.ts, evicted-files.ts).
  const holds = createCacheHolds(db);
  const evictedFiles = createEvictedFiles(db);
  const cap = deps.maxQueuedPerStage ?? 64;
  const log = deps.log ?? ((message: string) => console.warn(`[indexing] ${message}`));

  /** Seeds every stage for all assets (`since` undefined) or those created or changed since. */
  function seed(since?: number): number {
    return plans.reduce((sum, plan) => sum + rows.seed(plan, since), 0);
  }

  /** Stores a finished job's result for its row (or drops it when the asset moved on). */
  function settleSucceeded(row: StageRow, snapshot: JobSnapshot, at?: number): void {
    const definition = definitions.get(row.stage);
    if (!definition) return;
    const outcome = buildAssetIndexView(db, row.assetId, { requirePresent: false });
    if (outcome.kind !== 'view') return; // Gone: merged away by library.hash, or removed.
    if (outcome.view.generation !== row.generation) {
      // A re-index happened while the job ran: its result describes the old generation.
      rows.waiting(row.assetId, row.stage);
      return;
    }
    const result = guard(() => definition.result(snapshot.output, outcome.view));
    const stored = !result.ok
      ? result
      : !result.value.ok
        ? { ok: false as const, error: result.value.error }
        : outcomes.succeeded(
            row,
            result.value.value,
            snapshot.output,
            at ?? snapshot.finishedAt ?? undefined,
          );
    if (!stored.ok) {
      rows.failed(row.assetId, row.stage, stored.error);
      return;
    }
    deps.onSettled?.(row.stage, row.assetId);
  }

  /** Brings a row in line with its job's state. */
  /** `at`: when the job changed (its event's time), else the snapshot's times, else now. */
  function applyJobState(
    row: StageRow,
    state: JobState,
    snapshot?: JobSnapshot,
    error?: TaalcutError,
    at?: number,
  ) {
    switch (state) {
      case 'running':
        if (row.state !== 'running')
          rows.running(row.assetId, row.stage, at ?? snapshot?.startedAt ?? undefined);
        return;
      case 'queued':
        if (row.state === 'running') rows.requeued(row.assetId, row.stage);
        return;
      case 'paused':
        return; // Paused by indexing.pause (or the user): it stays this stage's job.
      case 'succeeded':
        if (snapshot) settleSucceeded(row, snapshot, at);
        modelWait.settled(row.assetId, row.stage);
        return;
      case 'failed':
        rows.failed(
          row.assetId,
          row.stage,
          snapshot?.error ?? error ?? CancelledError(),
          at ?? snapshot?.finishedAt ?? undefined,
        );
        modelWait.settled(row.assetId, row.stage);
        deps.onSettled?.(row.stage);
        return;
      case 'cancelled':
        rows.waiting(row.assetId, row.stage);
        modelWait.settled(row.assetId, row.stage);
        return;
    }
  }

  /** Follows one of our jobs: reads its snapshot when the change needs the output or the error. */
  async function onJobState(jobId: JobId, state: JobState, at?: number): Promise<void> {
    const row = rows.byJob(jobId);
    if (!row) return;
    if (state !== 'succeeded' && state !== 'failed')
      return applyJobState(row, state, undefined, undefined, at);
    const snapshot = await queue.get(jobId);
    const current = rows.byJob(jobId);
    if (!current) return;
    if (!snapshot.ok) return void rows.waiting(current.assetId, current.stage);
    applyJobState(current, snapshot.value.state, snapshot.value, undefined, at);
  }

  /**
   * Every queued or running row against its job: after a restart (the engine has reclaimed leases),
   * and now and then in case an event was missed. Succeeded → stored now; failed → failed; missing or
   * cancelled → waiting.
   */
  async function reconcile(): Promise<number> {
    // A row an older build failed for a missing model waits for it instead (model-wait.ts).
    let changed = modelWait.heal();
    for (const row of rows.active()) {
      if (!row.jobId) {
        rows.waiting(row.assetId, row.stage);
        changed++;
        continue;
      }
      const snapshot = await queue.get(row.jobId);
      if (!snapshot.ok) {
        rows.waiting(row.assetId, row.stage);
        changed++;
        continue;
      }
      const state = snapshot.value.state;
      if (isTerminalJobState(state) || (state === 'running') !== (row.state === 'running')) changed++;
      applyJobState(row, state, snapshot.value);
    }
    return changed;
  }

  /** Runnable rows of every stage, at most `cap` queued per stage, in feed order (feed-order.ts). */
  function candidates(): FeedCandidate[] {
    const out: FeedCandidate[] = [];
    plans.forEach((plan, stageIndex) => {
      const blocked = deps.notReady?.(plan.stage);
      if (blocked) return void rows.markBlocked(plan.stage, blocked);
      // A stage one of whose jobs found its model missing waits for it, trying one row now and then.
      const probe = modelWait.feed(plan, deps.now());
      if (probe !== undefined) {
        if (probe) out.push({ plan, stageIndex, row: probe });
        return;
      }
      const room = cap - rows.queuedCount(plan.stage);
      if (room > 0) for (const row of rows.runnable(plan, room)) out.push({ plan, stageIndex, row });
    });
    return out.sort(byFeedOrder(deps.now()));
  }

  /** Enqueues the runnable stages by asset, each job with its asset's import order. Returns how many. */
  async function feed(): Promise<number> {
    let fed = 0;
    for (const { plan, row } of candidates()) if (await feedOne(plan, row)) fed++;
    return fed;
  }

  /** Enqueues one runnable row's job (or skips, fails or defers the row). True when a job was added. */
  function feedOne(plan: StagePlan, candidate: RunnableStage): Promise<boolean> {
    // The asset's files stay in the media cache meanwhile: its job may be about to read them (cache-holds.ts).
    return holds.feeding(candidate.assetId, () => feedRow(plan, candidate));
  }

  async function feedRow(plan: StagePlan, candidate: RunnableStage): Promise<boolean> {
    const definition = definitions.get(plan.stage)!;
    const now = deps.now();
    const outcome = buildAssetIndexView(db, candidate.assetId);
    if (outcome.kind === 'gone') return false;
    if (outcome.kind === 'offline') {
      rows.markOffline();
      return false;
    }
    // A file it reads was evicted: the stage that made it runs again first, and this one waits for it.
    if (evictedFiles.remakeReads(candidate.assetId, definition.reads ?? [])) return false;
    const job = guard(() => definition.job(outcome.view));
    if (!job.ok) {
      rows.failed(candidate.assetId, plan.stage, job.error);
      return false;
    }
    if ('skip' in job.value) {
      const run = { assetId: candidate.assetId, stage: plan.stage, generation: candidate.generation };
      outcomes.skipped(run, definition, job.value, outcome.view);
      deps.onSettled?.(plan.stage);
      return false;
    }
    const boosted = candidate.boostedUntil !== null && candidate.boostedUntil > now;
    const priority = boosted ? 'high' : (job.value.priority ?? definition.priority);
    const key = `stage:${plan.stage}:${candidate.assetId}:${candidate.generation}:${definition.version}`;
    const enqueued = await queue.enqueue({
      kind: job.value.kind.kind,
      input: job.value.input,
      priority,
      // What it reads is in the key (round IX3): reset because an input changed, it gets a new job.
      idempotencyKey: key + invalidation.inputsKey(candidate.assetId, plan.stage),
      orderKey: importOrderKey(candidate),
    });
    if (!enqueued.ok) {
      log(`couldn't enqueue ${plan.stage} for ${candidate.assetId}: ${enqueued.error.code}`);
      rows.failed(candidate.assetId, plan.stage, enqueued.error);
      return false;
    }
    const snapshot = enqueued.value;
    rows.queued(candidate.assetId, plan.stage, {
      jobId: snapshot.id,
      version: definition.version,
      generation: candidate.generation,
      priority,
    });
    // The same key may already have a finished job (a stage cut off after its job succeeded).
    if (snapshot.state !== 'queued') applyJobState(rows.byJob(snapshot.id)!, snapshot.state, snapshot);
    return true;
  }

  return {
    rows,
    holds,
    evictedFiles,
    plans,
    ordered,
    definitions,
    seed,
    feed,
    reconcile,
    /** A component was installed: held stages probe on the next feed (model-wait.ts). */
    wakeModelWaits: () => modelWait.wake(),
    resetOutdated: (limit = 64) => resetOutdated(rows, ordered, invalidation, limit),
    onJobState,
    /** True when one of our rows follows this job. */
    follows: (jobId: JobId) => rows.byJob(jobId) !== undefined,
  };
}

export type PipelineCore = ReturnType<typeof createPipelineCore>;
