// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Render's job kinds (SPEC section 4) and the handlers the jobs process
 * registers. `render.export` runs in the render process: the handler calls
 * the RenderWorker (over main), passing the job's signal and progress, and
 * also watches the store so `render.cancel`, which only marks the row,
 * stops the export. `render.purge` trims the render caches.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  CancelledError,
  defineJobKind,
  err,
  NO_RETRY,
  ok,
  registerJob,
  RENDER_JOB_KINDS,
  renderExportJobInputSchema,
  renderExportJobOutputSchema,
  type Clock,
  type JobRegistration,
  type RenderId,
  type RenderStore,
  type RenderWorker,
  type RetryPolicy,
} from '@taalcut/core';
import type { RenderFolders } from '../engine/deps';
import { RUNNING_RENDER_STATUSES } from '../store/snapshot';
import {
  CONFORM_CACHE_MAX_BYTES,
  DELETED_RENDER_KEEP_MS,
  purgeDeletedRenders,
  purgeRenderCache,
} from '../store/purge';

/** i18n keys for JobProgress.stageKey outside the render process's own stages. */
export const RENDER_JOB_STAGES = { purging: 'jobs.stage.render.purging' } as const;

/** Two attempts; only retryable errors (core.process_restarted, render.capture_failed, core.timeout) retry. */
export const RENDER_EXPORT_RETRY: RetryPolicy = {
  maxAttempts: 2,
  backoff: { kind: 'fixed', delayMs: 2_000 },
};
export const RENDER_EXPORT_TIMEOUT_MS = 30 * 60_000;

/** One job per render: the command deduplicates requests, so the key is the render. */
export const renderExportJobKey = (renderId: RenderId) =>
  createHash('sha256').update(`render.export\0${renderId}`).digest('hex');

export const renderExportJob = defineJobKind({
  kind: RENDER_JOB_KINDS.export,
  input: renderExportJobInputSchema,
  output: renderExportJobOutputSchema,
  resource: 'gpu',
  priority: 'normal',
  retry: RENDER_EXPORT_RETRY,
  timeoutMs: RENDER_EXPORT_TIMEOUT_MS,
  resumable: true,
  idempotencyKey: (input) => renderExportJobKey(input.renderId),
});

export const renderPurgeInputSchema = z.object({
  /** Soft-deleted renders' files older than this go. Default 7 days. */
  deletedOlderThanMs: z.int().positive().optional(),
  /** Default 5 GB. */
  conformMaxBytes: z.int().positive().optional(),
});
export const renderPurgeOutputSchema = z.object({
  removed: z.int().nonnegative(),
  freedBytes: z.int().nonnegative(),
});

export const renderPurgeJob = defineJobKind({
  kind: RENDER_JOB_KINDS.purge,
  input: renderPurgeInputSchema,
  output: renderPurgeOutputSchema,
  resource: 'io',
  priority: 'low',
  retry: NO_RETRY,
  timeoutMs: 5 * 60_000,
  resumable: true,
});

/** The daily key a scheduler passes when it enqueues the purge, so one runs per day. */
export function renderPurgeJobKey(now: number): string {
  return `render.purge:${new Date(now).toISOString().slice(0, 10)}`;
}

export interface RenderJobDeps {
  /** The render process's worker (renderWorkerOverRpc in the jobs process). */
  readonly worker: RenderWorker;
  readonly folders: Pick<RenderFolders, 'conform' | 'work' | 'preview'>;
  readonly clock: Pick<Clock, 'now'>;
  /** When given: a render cancelled or deleted in the store stops its export, and purge clears deleted files. */
  readonly store?: Pick<RenderStore, 'get' | 'list' | 'update'>;
  /** How often a running export re-reads its row. Default 1 s. */
  readonly cancelPollMs?: number;
}

export function createRenderJobs(deps: RenderJobDeps): readonly JobRegistration[] {
  const pollMs = deps.cancelPollMs ?? 1_000;

  /** True when the row says stop: cancelled by render.cancel, or deleted. */
  const stopped = async (renderId: RenderId): Promise<boolean> => {
    if (!deps.store) return false;
    const record = await deps.store.get(renderId);
    return record.ok && (record.value.status === 'cancelled' || record.value.deletedAt !== null);
  };

  const exportHandler = registerJob(renderExportJob, async (input, context) => {
    if (context.signal.aborted || (await stopped(input.renderId))) return err(CancelledError());
    const controller = new AbortController();
    const abort = () => controller.abort();
    context.signal.addEventListener('abort', abort, { once: true });
    let polling = false;
    const timer = deps.store
      ? setInterval(() => {
          if (polling) return;
          polling = true;
          void stopped(input.renderId)
            .then((stop) => stop && abort())
            .finally(() => (polling = false));
        }, pollMs)
      : undefined;
    try {
      const result = await deps.worker.export(input, {
        signal: controller.signal,
        onProgress: (progress) => context.progress(progress),
      });
      if (!result.ok && controller.signal.aborted) return err(CancelledError());
      return result;
    } finally {
      if (timer) clearInterval(timer);
      context.signal.removeEventListener('abort', abort);
    }
  });

  const purgeHandler = registerJob(renderPurgeJob, async (input, context) => {
    context.progress({ fraction: null, stageKey: RENDER_JOB_STAGES.purging });
    const now = deps.clock.now();
    const keepWork = new Set<string>();
    let deletedFiles = 0;
    if (deps.store) {
      const listed = await deps.store.list({ includeDeleted: true });
      if (!listed.ok) return listed;
      // Running renders work there; needsAttention ones keep their file for "Export anyway".
      for (const record of listed.value)
        if (
          RUNNING_RENDER_STATUSES.has(record.status) ||
          (record.status === 'needsAttention' && record.deletedAt === null)
        )
          keepWork.add(record.id);
      const purged = await purgeDeletedRenders(deps.store, {
        now,
        keepMs: input.deletedOlderThanMs ?? DELETED_RENDER_KEEP_MS,
      });
      if (!purged.ok) return purged;
      deletedFiles = purged.value;
    }
    if (context.signal.aborted) return err(CancelledError());
    const cache = await purgeRenderCache(deps.folders, {
      now,
      conformMaxBytes: input.conformMaxBytes ?? CONFORM_CACHE_MAX_BYTES,
      keepWork,
    });
    context.progress({ fraction: 1, stageKey: RENDER_JOB_STAGES.purging });
    return ok({ removed: cache.removed + deletedFiles, freedBytes: cache.freedBytes });
  });

  return [exportHandler, purgeHandler];
}
