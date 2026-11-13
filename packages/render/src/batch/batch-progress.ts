// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A batch's progress (P3-V16): its renders counted by state, folded from the store's rows, and the time left
 * when there is something to go on: the running render's own estimate plus, per render still queued, the
 * batch's average time per finished render. `renders.watchBatch` streams it.
 */
import {
  err,
  NotFoundError,
  ok,
  type AsyncResult,
  type RenderBatchId,
  type RenderBatchProgress,
  type RenderSnapshot,
  type RenderStore,
} from '@taalcut/core';
import type { LiveRenders } from '../engine/live';
import { snapshotOf } from '../router/snapshot';

type Row = Pick<RenderSnapshot, 'status' | 'progress' | 'createdAt' | 'finishedAt'>;

const RUNNING = new Set(['rendering', 'checking', 'fixing']);

function etaOf(rows: readonly Row[], queued: number, running: readonly Row[]): number | null {
  const finished = rows.filter((row) => row.finishedAt !== null && row.status !== 'cancelled');
  const runningEta = running.reduce((sum, row) => sum + (row.progress?.etaMs ?? 0), 0);
  if (queued === 0)
    return running.length === 0
      ? 0
      : running.every((row) => row.progress?.etaMs !== undefined)
        ? runningEta
        : null;
  if (finished.length === 0) return null;
  const started = Math.min(...rows.map((row) => row.createdAt));
  const last = Math.max(...finished.map((row) => row.finishedAt ?? started));
  const perRender = (last - started) / finished.length;
  return Math.round(runningEta + queued * perRender);
}

export function foldBatch(batchId: RenderBatchId, rows: readonly Row[]): RenderBatchProgress {
  const count = (status: Row['status']) => rows.filter((row) => row.status === status).length;
  const running = rows.filter((row) => RUNNING.has(row.status));
  const queued = count('queued');
  return {
    batchId,
    total: rows.length,
    queued,
    running: running.length,
    ready: count('ready'),
    needsAttention: count('needsAttention'),
    failed: count('failed'),
    cancelled: count('cancelled'),
    etaMs: etaOf(rows, queued, running),
  };
}

/** The batch's progress now; a batch with no renders is not found. */
export async function batchProgress(
  store: RenderStore,
  live: Pick<LiveRenders, 'progress'>,
  batchId: RenderBatchId,
): AsyncResult<RenderBatchProgress> {
  const rows = await store.list({ batchId, includeDeleted: true });
  if (!rows.ok) return rows;
  if (rows.value.length === 0) return err(NotFoundError({ entity: 'renderBatch', id: batchId }));
  return ok(
    foldBatch(
      batchId,
      rows.value.map((record) => snapshotOf(record, live)),
    ),
  );
}
