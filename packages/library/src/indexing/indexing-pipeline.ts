// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `createIndexingPipeline`: the pipeline core (pipeline.ts) with its loop
 * and controls. One step runs at a time (a promise chain), so the 1 s poll,
 * job events and `indexing.*` calls never interleave. What the user waits
 * for runs first (`prioritise`), `pause` survives restarts (a setting), and
 * the `library.indexing` event goes out at most twice a second, only on change (pipeline-events.ts).
 * After every step the milestone sweep stores which assets became searchable
 * or complete (milestones.ts), so the status it publishes counts them. Files
 * the media cache evicts (`media.derivedEvicted`) are let go at once and made
 * again when their clip is next waited for (evicted-files.ts); before each goes the cache asks (`release`), and the
 * files of a clip a window shows, or those a stage is reading, stay (cache-holds.ts).
 */
import {
  createSerialQueue,
  ok,
  type AssetId,
  type Clock,
  type DuplicatePassDefinition,
  type EventBus,
  type IndexStageDefinition,
  type IndexingStatus,
  type JobId,
  type JobQueue,
  type Result,
  type SourceId,
  type VectorIndex,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createSettingsRepository } from '../repositories/settings';
import { JOB_PRIORITY_VALUES } from '../schema/jobs';
import { applyDuplicateGroups, duplicatePassRequest, duplicateShotViews } from './duplicates';
import { createPipelineMilestones } from './milestones';
import { INDEXING_PAUSED_SETTING, isIndexingPaused } from './paused';
import { createPipelineCore } from './pipeline';
import { createPipelineEvents } from './pipeline-events';
import { isFinal, Settling } from './settling';
import { indexingStatus } from './status';

export interface IndexingPipelineDeps {
  readonly db: LibraryDatabase;
  readonly queue: JobQueue;
  readonly events: EventBus;
  readonly stages: readonly IndexStageDefinition[];
  readonly duplicates?: DuplicatePassDefinition;
  /** Default: the database's clock. */
  readonly clock?: Clock;
  /** Poll for rows other processes wrote. Default 1000 ms. */
  readonly pollMs?: number;
  /** Default 64. */
  readonly maxQueuedPerStage?: number;
  /** The duplicates pass waits this long after the last analysis settles. Default 30 s. */
  readonly duplicatesDebounceMs?: number;
  readonly log?: (message: string) => void;
  /** A reason while a stage can't run yet (its model isn't installed): its rows wait instead of failing. */
  readonly notReady?: (stage: string) => string | undefined;
  /** The active embedding space's index, once there is one: a skip's `clears` removes vectors there (IX3). */
  readonly vectors?: (() => VectorIndex | undefined) | undefined;
  /** How often a stage held for its model (a job said it is missing) tries one row again. Default 5 min. */
  readonly modelProbeMs?: number;
}

export interface IndexingPipeline {
  /**
   * Follows job events, reconciles rows with their jobs (after the engine reclaimed leases), seeds and
   * feeds, then polls every `pollMs` (`poll: false`: no timer; tests call tick()).
   */
  start(options?: { readonly poll?: boolean }): Promise<void>;
  stop(): void;
  /** One poll: seed new assets, reset outdated stages when idle, feed the queue, publish status. */
  tick(): Promise<void>;
  reconcile(): Promise<void>;
  /** Resolves once every step started so far has finished. */
  idle(): Promise<void>;
  /**
   * Resolves once a finished job this pipeline follows has had its outcome stored and what it unblocked
   * fed to the queue; at once for any other job. The job engine waits for it (bounded) before it offers
   * the job's slot again, so the asset's next stage is claimed before the next asset's work (depth-first).
   */
  settled(jobId: JobId): Promise<void>;
  status(): IndexingStatus;
  importStatus(sourceId?: SourceId): IndexingStatus;
  /**
   * Someone waits for these assets (their clip page is open while they are indexed, or shows a file the media cache
   * let go): their waiting stages go first for the next 10 minutes, and the stages whose file was let go wait again
   * to make it (evicted-files.ts).
   */
  prioritise(assetIds: readonly AssetId[]): Promise<Result<{ boosted: number }>>;
  /** The media cache evicted these keys (`media.derivedEvicted`, which `start` follows): let them go now. */
  evicted(keys: readonly string[]): Promise<Result<{ assets: number }>>;
  /**
   * The media cache is about to delete this key (its `release`): false while the asset still needs it (a window
   * shows its clip, or a stage of it is being fed, queued or running); else its row goes and its stage is marked, now.
   */
  release(key: string): boolean;
  pause(): Promise<Result<IndexingStatus>>;
  resume(): Promise<Result<IndexingStatus>>;
  retryFailed(sourceId?: SourceId): Promise<Result<{ requeued: number }>>;
  /**
   * A model or runtime was just installed (UX2-MODELS): the stages that wait for their model look again now. A
   * held stage tries one row at once instead of at its next probe; a stage `notReady` blocked runs as soon as
   * `notReady` lets it (re-read the installed models before calling this). Resolves once that feed is done.
   */
  modelsInstalled(): Promise<void>;
}

const BOOST_MS = 10 * 60_000;
/** Missed job events are caught by reconciling every this many polls. */
const RECONCILE_EVERY = 10;
/** Seeding looks this far back for assets other processes added (their clocks may differ a little). */
const SEED_MARGIN_MS = 10_000;

export function createIndexingPipeline(deps: IndexingPipelineDeps): IndexingPipeline {
  const { db, queue, events } = deps;
  const now = () => (deps.clock ? deps.clock.now() : db.clock());
  const settings = createSettingsRepository(db);
  const pollMs = deps.pollMs ?? 1000;
  const debounceMs = deps.duplicatesDebounceMs ?? 30_000;
  const log = deps.log ?? ((message: string) => console.warn(`[indexing] ${message}`));
  let duplicatesTimer: ReturnType<typeof setTimeout> | undefined;
  let duplicatesJob: JobId | undefined;

  const core = createPipelineCore({
    db,
    queue,
    events,
    stages: deps.stages,
    now,
    ...(deps.maxQueuedPerStage ? { maxQueuedPerStage: deps.maxQueuedPerStage } : {}),
    ...(deps.notReady ? { notReady: deps.notReady } : {}),
    ...(deps.modelProbeMs ? { modelProbeMs: deps.modelProbeMs } : {}),
    vectors: deps.vectors,
    log,
    onSettled: (stage, stored) => {
      if (deps.duplicates?.after.includes(stage)) scheduleDuplicates();
      if (stored) out.changed(stored);
    },
  });
  const order = core.ordered.map((s) => s.stage);
  const milestones = createPipelineMilestones({ db, events, stages: core.ordered, log });
  const { evictedFiles, holds } = core;

  const steps = createSerialQueue();
  /** Steps asked for so far: `idle` waits until no more come while it waits. */
  let asked = 0;
  /** One step at a time. A failed step is logged here, whoever asked for it, and its caller sees it too. */
  function serial<T>(step: () => Promise<T> | T): Promise<T> {
    asked += 1;
    const next = steps.run(step);
    void next.catch((cause: unknown) => log(`step failed: ${String(cause)}`));
    return next;
  }

  const paused = () => isIndexingPaused(db);
  const status = () => indexingStatus(db, { order, paused: paused() });

  // library.indexing and library.changed (pipeline-events.ts).
  const out = createPipelineEvents({ events, status, now, later: (publish) => void serial(publish) });

  function scheduleDuplicates(): void {
    if (!deps.duplicates) return;
    if (duplicatesTimer) clearTimeout(duplicatesTimer);
    duplicatesTimer = setTimeout(() => {
      duplicatesTimer = undefined;
      void serial(runDuplicates);
    }, debounceMs);
  }

  async function runDuplicates(): Promise<void> {
    const definition = deps.duplicates!;
    const request = duplicatePassRequest(definition, duplicateShotViews(db));
    if (!request.ok) return log(`duplicates pass: ${request.error.code}`);
    if (!request.value) return;
    const enqueued = await queue.enqueue(request.value);
    if (!enqueued.ok) return log(`duplicates pass: ${enqueued.error.code}`);
    duplicatesJob = enqueued.value.id;
    if (enqueued.value.state === 'succeeded') settleDuplicates(enqueued.value.output);
  }

  function settleDuplicates(output: unknown): void {
    duplicatesJob = undefined;
    const stored = applyDuplicateGroups(db, deps.duplicates!, output);
    if (!stored.ok) log(`duplicates pass: ${stored.error.code}`);
  }

  let polls = 0;
  let lastSeed: number | undefined;
  async function tick(): Promise<void> {
    const started = now();
    core.seed(lastSeed === undefined ? undefined : lastSeed - SEED_MARGIN_MS);
    lastSeed = started;
    core.rows.markOffline();
    if (++polls % RECONCILE_EVERY === 0) await core.reconcile();
    if (!paused()) {
      const fed = await core.feed();
      if (fed === 0 && core.rows.active().length === 0 && core.resetOutdated() > 0) await core.feed();
    }
    milestones.sweep();
    out.publish();
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void)[] = [];
  let feedQueued: Promise<void> | undefined;
  /** Feeds again soon after a stage settled, so dependants don't wait for the next poll. The feed's step. */
  function kick(): Promise<void> {
    feedQueued ??= serial(async () => {
      feedQueued = undefined;
      if (!paused()) await core.feed();
      milestones.sweep();
      out.publish();
    });
    return feedQueued;
  }
  const settling = new Settling();

  /** Let the evicted files go: their rows at once, and the clips that showed them refresh (evicted-files.ts). */
  function evicted(keys: readonly string[]): Promise<Result<{ assets: number }>> {
    return serial(() => {
      const assets = evictedFiles.evicted(keys);
      if (!assets.ok) {
        log(`evicted files kept their rows: ${assets.error.code}`);
        return assets;
      }
      for (const assetId of assets.value) out.changed(assetId);
      return ok({ assets: assets.value.length });
    });
  }

  return {
    async start(options = {}) {
      const evictions = events.on('media.derivedEvicted', ({ payload }) => void evicted(payload.keys));
      const jobs = events.on('job.stateChanged', ({ payload, at }) => {
        if (payload.jobId === duplicatesJob) {
          if (payload.to === 'succeeded')
            void serial(async () => {
              const snapshot = await queue.get(payload.jobId);
              if (snapshot.ok) settleDuplicates(snapshot.value.output);
            });
          return;
        }
        if (!core.follows(payload.jobId)) return;
        const finished = isFinal(payload.to);
        let fed: Promise<void> | undefined;
        const step = serial(async () => {
          await core.onJobState(payload.jobId, payload.to, at);
          if (finished) fed = kick();
        });
        // The feed is a later step on the same chain: waiting for it inside this step would deadlock.
        if (finished)
          settling.track(
            payload.jobId,
            step.then(() => fed),
          );
      });
      unsubscribe = [evictions, jobs];
      // Other processes read the stages' order and milestones; then the first sweep backfills, silently.
      await serial(milestones.start);
      await serial(() => core.reconcile());
      await serial(tick);
      scheduleDuplicates();
      if (options.poll !== false) timer = setInterval(() => void serial(tick), pollMs);
    },
    stop() {
      for (const off of unsubscribe) off();
      unsubscribe = [];
      if (timer) clearInterval(timer);
      if (duplicatesTimer) clearTimeout(duplicatesTimer);
      out.stop();
      timer = duplicatesTimer = undefined;
    },
    tick: () => serial(tick),
    settled: (jobId) => settling.settled(jobId),
    reconcile: () => serial(async () => void (await core.reconcile())),
    idle: async () => {
      let seen: number;
      do {
        seen = asked;
        await steps.settled();
      } while (seen !== asked);
    },
    status,
    importStatus: (sourceId) =>
      indexingStatus(db, { order, paused: paused(), ...(sourceId ? { sourceId } : {}) }),
    prioritise: (assetIds) =>
      serial(() => {
        for (const assetId of evictedFiles.remake(assetIds)) out.changed(assetId);
        const until = now() + BOOST_MS;
        core.rows.boost(assetIds, until);
        db.driver
          .prepare(
            `UPDATE jobs SET priority = ?, updated_at = ? WHERE state = 'queued' AND priority < ? AND id IN (
               SELECT job_id FROM asset_index_stages
               WHERE asset_id IN (SELECT value FROM json_each(?)) AND job_id IS NOT NULL)`,
          )
          .run(JOB_PRIORITY_VALUES.high, now(), JOB_PRIORITY_VALUES.high, JSON.stringify(assetIds));
        const boosted = db.driver
          .prepare(
            `SELECT COUNT(DISTINCT asset_id) AS n FROM asset_index_stages
             WHERE asset_id IN (SELECT value FROM json_each(?)) AND boosted_until = ?`,
          )
          .get(JSON.stringify(assetIds), until);
        void kick();
        return ok({ boosted: Number(boosted?.n ?? 0) });
      }),
    evicted,
    release(key) {
      const released = evictedFiles.release(key, holds.holds);
      if (!released.ok) {
        log(`kept ${key} in the media cache: its row didn't go (${released.error.code})`);
        return false;
      }
      if (released.value.assetId) out.changed(released.value.assetId);
      return released.value.released;
    },
    pause: () =>
      serial(async () => {
        const saved = settings.set(INDEXING_PAUSED_SETTING.key, true);
        if (!saved.ok) return saved;
        for (const row of core.rows.active()) if (row.jobId) await queue.pause(row.jobId);
        out.publish();
        return ok(status());
      }),
    resume: () =>
      serial(async () => {
        const saved = settings.set(INDEXING_PAUSED_SETTING.key, false);
        if (!saved.ok) return saved;
        for (const row of core.rows.active()) {
          if (!row.jobId) continue;
          const job = await queue.get(row.jobId);
          if (job.ok && job.value.state === 'paused') await queue.resume(row.jobId);
        }
        void kick();
        return ok(status());
      }),
    modelsInstalled: () => serial(() => core.wakeModelWaits()).then(() => kick()),
    retryFailed: (sourceId) =>
      serial(() => {
        const requeued = core.rows.retryFailed(sourceId);
        void kick();
        return ok({ requeued });
      }),
  };
}
