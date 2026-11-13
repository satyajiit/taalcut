// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A batch's progress from its renders as they are now (P3-V16), folded the way render's `foldBatch` folds the
 * store's rows, so the renderBatch card moves with every render without a new card: counts by state and the time
 * left (the running render's own estimate plus, per render still queued, the batch's time per finished render).
 */
import type { CardOf, RenderBatchProgress, RenderId, RenderSnapshot } from '@taalcut/core';

export type BatchItem = CardOf<'renderBatch'>['items'][number];
export type BatchItemStatus = BatchItem['status'];

const RUNNING = new Set<RenderSnapshot['status']>(['rendering', 'checking', 'fixing']);

const AS_ITEM: Readonly<Record<RenderSnapshot['status'], BatchItemStatus>> = {
  queued: 'queued',
  rendering: 'running',
  checking: 'running',
  fixing: 'running',
  ready: 'ready',
  needsAttention: 'needsAttention',
  failed: 'failed',
  cancelled: 'cancelled',
};

/** A render's status as a batch row says it. */
export function itemStatus(item: BatchItem, live: RenderSnapshot | null | undefined): BatchItemStatus {
  return live ? AS_ITEM[live.status] : item.status;
}

type Row = Pick<RenderSnapshot, 'status' | 'progress' | 'createdAt' | 'finishedAt'>;

function etaOf(rows: readonly Row[], queued: number): number | null {
  const running = rows.filter((row) => RUNNING.has(row.status));
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

/**
 * The card's progress, or the live one once every queued item's render is known (`live` has a snapshot for each
 * render id). Items without a render yet count as queued.
 */
export function foldItems(
  card: CardOf<'renderBatch'>,
  live: ReadonlyMap<RenderId, RenderSnapshot | null>,
): RenderBatchProgress {
  const snapshots = card.items.map((item) => (item.renderId ? live.get(item.renderId) : undefined));
  if (snapshots.some((snapshot, index) => card.items[index]?.renderId && !snapshot)) return card.progress;
  const statuses = card.items.map((item, index) => itemStatus(item, snapshots[index]));
  const count = (status: BatchItemStatus) => statuses.filter((each) => each === status).length;
  const queued = count('queued');
  const rows = snapshots.filter((snapshot): snapshot is RenderSnapshot => Boolean(snapshot));
  return {
    batchId: card.progress.batchId,
    total: card.items.length,
    queued,
    running: count('running'),
    ready: count('ready'),
    needsAttention: count('needsAttention'),
    failed: count('failed'),
    cancelled: count('cancelled'),
    etaMs: rows.length === 0 ? card.progress.etaMs : etaOf(rows, queued),
  };
}

/** How much of the batch is behind it, 0–1: finished renders whole, the running ones by their fraction. */
export function doneFraction(
  progress: RenderBatchProgress,
  running: readonly (RenderSnapshot | null | undefined)[],
): number {
  if (progress.total === 0) return 0;
  const finished = progress.ready + progress.needsAttention + progress.failed + progress.cancelled;
  const partial = running.reduce(
    (sum, render) => sum + (render && RUNNING.has(render.status) ? (render.progress?.fraction ?? 0) : 0),
    0,
  );
  return Math.min(1, (finished + partial) / progress.total);
}
