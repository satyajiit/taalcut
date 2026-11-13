// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Use it" on a stock result for a gap (P3-B8, P3-V18; card protocol rule 3: the second command only after the
 * first succeeded): library.importStock, then its `library.stockImport` job to its end (job.stateChanged), then
 * timeline.fillGap with the new asset. An item already in the library skips the import. The window has no jobs
 * namespace, so the asset id after the job comes from importing the same item again: the library answers an item
 * it has with its asset and no job (packages/library stock-commands).
 */
import {
  callRpc,
  CancelledError,
  err,
  ProcessRestartedError,
  newId,
  ok,
  type AssetId,
  type JobId,
  type ProjectId,
  type Result,
  type StockResult,
  type TaalcutError,
  type TimelineId,
  type TimelineItemId,
} from '@taalcut/core';
import type { Backend } from '../../../backend/backend';

export interface StockUse {
  readonly item: StockResult;
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  readonly gapId: TimelineItemId;
}

interface ImportAnswer {
  readonly jobId: JobId | null;
  readonly assetId: AssetId | null;
}

const isAnswer = (value: unknown): value is ImportAnswer =>
  typeof value === 'object' && value !== null && 'jobId' in value && 'assetId' in value;

/**
 * What went wrong, in the library's own words (its `library.stock_download_failed`, retryable): the import answered
 * without the asset. A stream that ended is a restart, not a cancel; only a job that was cancelled says "Stopped".
 */
const downloadFailed = (): TaalcutError => ({
  code: 'library.stock_download_failed',
  messageKey: 'errors.library.stock_download_failed',
  retryable: true,
});
const restarted = (): TaalcutError => ProcessRestartedError({ process: 'library' });

async function dispatch(backend: Backend, name: string, payload: unknown): Promise<Result<unknown>> {
  const receipt = await callRpc(
    backend.commands.dispatch({ name, payload, source: 'ui', idempotencyKey: newId() }),
  );
  return receipt.ok ? ok(receipt.value.result) : receipt;
}

function importStock(backend: Backend, use: StockUse): Promise<Result<unknown>> {
  const { provider, providerId, kind, renditionKey } = use.item;
  return dispatch(backend, 'library.importStock', {
    importId: newId<'StockImport'>(),
    item: { provider, providerId, kind, renditionKey },
    projectId: use.projectId,
  });
}

/** Opens a job.stateChanged stream first (so a quick job's end isn't missed), then waits for `jobId` to end. */
async function watchJobs(backend: Backend, signal: AbortSignal) {
  const stream = await callRpc(backend.events.subscribe({ types: ['job.stateChanged'] }, { signal }));
  if (!stream.ok) return stream;
  const iterator = stream.value[Symbol.asyncIterator]();
  const ended = async (jobId: JobId): Promise<Result<void>> => {
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done) return err(restarted());
        const event = next.value;
        if (event.type !== 'job.stateChanged' || event.payload.jobId !== jobId) continue;
        const { to, error } = event.payload;
        if (to === 'succeeded') return ok(undefined);
        if (to === 'failed') return err(error ?? downloadFailed());
        if (to === 'cancelled') return err(CancelledError());
      }
    } catch {
      return err(restarted());
    }
  };
  return ok({ ended });
}

/** The stock video's asset in the library: imported now (its job waited for) or already there. */
async function assetFor(backend: Backend, use: StockUse): Promise<Result<AssetId>> {
  if (use.item.alreadyImported) return ok(use.item.alreadyImported);
  const controller = new AbortController();
  try {
    const jobs = await watchJobs(backend, controller.signal);
    if (!jobs.ok) return jobs;
    const first = await importStock(backend, use);
    if (!first.ok) return first;
    if (!isAnswer(first.value)) return err(downloadFailed());
    if (first.value.assetId) return ok(first.value.assetId);
    if (!first.value.jobId) return err(downloadFailed());
    const ended = await jobs.value.ended(first.value.jobId);
    if (!ended.ok) return ended;
    const again = await importStock(backend, use);
    if (!again.ok) return again;
    return isAnswer(again.value) && again.value.assetId ? ok(again.value.assetId) : err(downloadFailed());
  } finally {
    controller.abort();
  }
}

export async function fillGapWithStock(
  backend: Backend,
  use: StockUse,
): Promise<Result<{ readonly assetId: AssetId }>> {
  const asset = await assetFor(backend, use);
  if (!asset.ok) return asset;
  const filled = await dispatch(backend, 'timeline.fillGap', {
    projectId: use.projectId,
    timelineId: use.timelineId,
    gapId: use.gapId,
    media: { kind: 'video', assetId: asset.value, shotId: null },
  });
  return filled.ok ? ok({ assetId: asset.value }) : filled;
}
