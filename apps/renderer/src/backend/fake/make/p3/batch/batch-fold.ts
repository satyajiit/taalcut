// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A batch's progress from its renders (P3-V16), folded as @taalcut/render's `foldBatch` folds the store's rows:
 * counts by state, and the time left (the running render's own estimate plus, per render still queued, the batch's
 * time per finished render; 0 once nothing is left, null when there is nothing to go on yet).
 */
import type { RenderBatchId, RenderBatchProgress, RenderSnapshot } from '@taalcut/core';

type Row = Pick<RenderSnapshot, 'status' | 'progress' | 'createdAt' | 'finishedAt'>;

const RUNNING = new Set<RenderSnapshot['status']>(['rendering', 'checking', 'fixing']);

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
  return Math.round(runningEta + (queued * (last - started)) / finished.length);
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
