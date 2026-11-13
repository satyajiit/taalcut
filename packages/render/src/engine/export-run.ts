// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * RenderWorker.export: runs one render's stages and owns everything around
 * them (SPEC section 4): the status in the store, cancellation (the job's
 * signal, or render.cancel / render.delete seen in the store), attempts (a
 * retryable failure goes back to queued until the job's last attempt),
 * the work folder, and `render.finished` for "Notify me".
 *
 * A render already in a final state answers with that state, and a render
 * already running in this process is joined so a reclaimed job never renders
 * twice. An abort by the caller alone (when the store does not say cancelled
 * or deleted, e.g. the jobs process died) puts the render back to `queued`
 * instead of `cancelled`, so the reclaimed job can finish it.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type ExportRequest,
  type JobProgress,
  type RenderExportJobOutput,
  type RenderId,
  type RenderRecord,
  type TaalcutError,
} from '@taalcut/core';
import { CaptureFailed } from '../errors';
import { renderWorkDir } from '../store/paths';
import type { RenderEngineDeps } from './deps';
import { runStages } from './export';
import type { LiveRenders } from './live';
import { createProgressTracker } from './progress';

const FINAL = new Set(['ready', 'needsAttention', 'failed', 'cancelled']);
/** The render.export job kind's attempts. */
export const EXPORT_MAX_ATTEMPTS = 2;
const CANCEL_POLL_MS = 500;
/** Kept in a needsAttention render's work folder: what the user may still deliver. */
const KEEP = /^(final\.(mp4|srt|vtt)|attempts)$/;

export interface ExportCallOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: JobProgress) => void;
}

interface InFlightWaiter {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: JobProgress) => void;
  onAbort?: () => void;
}

interface InFlightExport {
  readonly controller: AbortController;
  readonly waiters: Set<InFlightWaiter>;
  readonly promise: AsyncResult<RenderExportJobOutput>;
}

const inFlightByLive = new WeakMap<LiveRenders, Map<RenderId, InFlightExport>>();

function inFlightMap(live: LiveRenders): Map<RenderId, InFlightExport> {
  let map = inFlightByLive.get(live);
  if (!map) {
    map = new Map();
    inFlightByLive.set(live, map);
  }
  return map;
}

const outputOf = (record: RenderRecord): RenderExportJobOutput => ({
  renderId: record.id,
  status: record.status,
  qa: record.qa,
});

const publicError = (error: TaalcutError) => {
  const { detail: _detail, ...visible } = error;
  return visible;
};

/** The render's work folder: <work>/<renderId>. */
export const workFolder = (deps: Pick<RenderEngineDeps, 'folders'>, renderId: RenderId) =>
  renderWorkDir(deps.folders, renderId);

/** Counts this render's runs in its work folder, so a crash and a retry both count. */
async function nextAttempt(workDir: string): Promise<number> {
  const file = join(workDir, 'attempts');
  const previous = Number.parseInt(await readFile(file, 'utf8').catch(() => '0'), 10) || 0;
  await writeFile(file, String(previous + 1));
  return previous + 1;
}

async function writeAttempt(workDir: string, count: number): Promise<void> {
  await writeFile(join(workDir, 'attempts'), String(count)).catch(() => undefined);
}

async function tidy(workDir: string, keepDeliverable: boolean): Promise<void> {
  if (!keepDeliverable) {
    await rm(workDir, { recursive: true, force: true });
    return;
  }
  const entries = await readdir(workDir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((name) => !KEEP.test(name))
      .map((name) => rm(join(workDir, name), { recursive: true, force: true })),
  );
}

async function announce(deps: RenderEngineDeps, renderId: RenderId): Promise<void> {
  const latest = await deps.store.get(renderId);
  if (!latest.ok) return;
  const { status } = latest.value;
  if (status !== 'ready' && status !== 'needsAttention' && status !== 'failed' && status !== 'cancelled')
    return;
  deps.events.emit('render.finished', {
    renderId,
    projectId: latest.value.projectId,
    status,
    notify: latest.value.notify,
    name: latest.value.name,
  });
}

function joinExport(
  live: LiveRenders,
  renderId: RenderId,
  entry: InFlightExport,
  options: ExportCallOptions,
): AsyncResult<RenderExportJobOutput> {
  if (options.signal?.aborted) {
    if (entry.waiters.size === 0) {
      entry.controller.abort();
      return entry.promise.then(() => err(CancelledError()));
    }
    return Promise.resolve(err(CancelledError()));
  }
  const current = live.progress(renderId);
  if (current) options.onProgress?.(current);
  return new Promise((resolve) => {
    const waiter: InFlightWaiter = {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    };
    const onAbort = () => {
      entry.waiters.delete(waiter);
      if (entry.waiters.size === 0) {
        entry.controller.abort();
        void entry.promise.then(() => resolve(err(CancelledError())));
      } else {
        resolve(err(CancelledError()));
      }
    };
    waiter.onAbort = onAbort;
    entry.waiters.add(waiter);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    void entry.promise.then((result) => {
      if (waiter.onAbort) options.signal?.removeEventListener('abort', waiter.onAbort);
      entry.waiters.delete(waiter);
      resolve(result);
    });
  });
}

async function executeExport(
  deps: RenderEngineDeps,
  live: LiveRenders,
  record: RenderRecord,
  controller: AbortController,
  waiters: ReadonlySet<InFlightWaiter>,
): AsyncResult<RenderExportJobOutput> {
  const renderId = record.id;
  const workDir = workFolder(deps, renderId);
  await mkdir(workDir, { recursive: true });
  const attempt = await nextAttempt(workDir);

  const poll = setInterval(() => {
    void deps.store.get(renderId).then((latest) => {
      if (latest.ok && (latest.value.status === 'cancelled' || latest.value.deletedAt !== null))
        controller.abort();
    });
  }, CANCEL_POLL_MS);
  const tracker = createProgressTracker((progress) => {
    live.setProgress(renderId, progress);
    for (const waiter of waiters) waiter.onProgress?.(progress);
  }, deps.clock.now);
  const fallback = deps.onFallback ?? ((event) => deps.events.emit('compute.fallback', event));
  const setStatus = async (status: 'rendering' | 'checking' | 'fixing') => {
    if (controller.signal.aborted) return;
    await deps.store.update(renderId, { status, ...(status === 'rendering' ? { error: null } : {}) });
    live.changed();
  };

  let result: Awaited<ReturnType<typeof runStages>>;
  try {
    result = await runStages(
      { deps, record, workDir, signal: controller.signal, tracker, fallback },
      setStatus,
    );
  } catch (cause) {
    // A throw from the producer or the browser (not an error value): retryable, unless we were cancelling.
    result = err(
      controller.signal.aborted ? CancelledError() : CaptureFailed(undefined, { detail: String(cause) }),
    );
  } finally {
    clearInterval(poll);
  }
  live.setProgress(renderId, null);

  if (result.ok) {
    await tidy(workDir, result.value.status === 'needsAttention');
    live.changed();
    await announce(deps, renderId);
    return ok(outputOf(result.value));
  }
  const error = result.error;
  if (controller.signal.aborted || error.code === 'core.cancelled') {
    const latest = await deps.store.get(renderId);
    const storeCancelled =
      latest.ok && (latest.value.status === 'cancelled' || latest.value.deletedAt !== null);
    if (storeCancelled) {
      if (latest.value.status !== 'cancelled')
        await deps.store.update(renderId, { status: 'cancelled', finishedAt: deps.clock.now() });
      await tidy(workDir, false);
      live.changed();
      await announce(deps, renderId);
      return err(CancelledError());
    }
    // Caller disconnected without render.cancel / render.delete: put back to queued for the reclaimed job.
    await writeAttempt(workDir, Math.max(0, attempt - 1));
    if (latest.ok && !FINAL.has(latest.value.status)) await deps.store.update(renderId, { status: 'queued' });
    live.changed();
    return err(CancelledError());
  }
  if (error.retryable && attempt < EXPORT_MAX_ATTEMPTS) {
    // The job runs it again: the render waits as queued, its error shown until the retry starts.
    await deps.store.update(renderId, { status: 'queued', error: publicError(error) });
    live.changed();
    return err(error);
  }
  await deps.store.update(renderId, {
    status: 'failed',
    error: publicError(error),
    finishedAt: deps.clock.now(),
  });
  await tidy(workDir, false);
  live.changed();
  await announce(deps, renderId);
  return err(error);
}

export async function runExport(
  deps: RenderEngineDeps,
  live: LiveRenders,
  input: { readonly renderId: RenderId; readonly request: ExportRequest },
  options: ExportCallOptions = {},
): AsyncResult<RenderExportJobOutput> {
  const renderId = input.renderId;
  const active = inFlightMap(live);
  const running = active.get(renderId);
  if (running) {
    if (!running.controller.signal.aborted) return joinExport(live, renderId, running, options);
    await running.promise;
  }
  const existing = await deps.store.get(renderId);
  if (!existing.ok) return existing;
  if (existing.value.deletedAt !== null || FINAL.has(existing.value.status))
    return ok(outputOf(existing.value));

  const controller = new AbortController();
  const waiters = new Set<InFlightWaiter>();
  if (options.signal?.aborted) controller.abort();
  const promise = executeExport(deps, live, existing.value, controller, waiters);
  const entry: InFlightExport = { controller, waiters, promise };
  active.set(renderId, entry);
  void promise.finally(() => {
    if (active.get(renderId) === entry) active.delete(renderId);
  });
  return joinExport(live, renderId, entry, options);
}
