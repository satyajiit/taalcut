// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The batch render queue's commands (P3-V16): one Render per item at low priority with the batch's id and
 * each project's settings, a retry is the same batch, a bad item refuses the whole batch before anything is
 * queued, and cancelBatch cancels what is still waiting. Progress folds from the rows.
 */
import { describe, expect, it } from 'vitest';
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  newId,
  unwrap,
  type Timeline,
} from '@taalcut/core';
import { createBatchCommands } from '../../src/batch/batch-commands';
import { foldBatch } from '../../src/batch/batch-progress';
import { createRenderCommands } from '../../src/commands/render-commands';
import { memoryRenderStore } from '../support/render-store';
import { makeTimeline } from '../support/timeline';
import { memoryTimelines, recordingEnqueuer, UI } from '../commands/support';

function setup(timelines: Timeline[]) {
  const store = memoryRenderStore();
  const enqueuer = recordingEnqueuer();
  const settings = createMemorySettingsStore();
  const clock = createManualClock(1_000);
  const deps = { store, enqueuer, timelines: memoryTimelines(...timelines), settings, clock };
  const batch = createBatchCommands(deps);
  const render = createRenderCommands(deps);
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  bus.register(...batch.all, ...render.all);
  return { store, enqueuer, settings, bus, batch, render };
}

const twenty = () => Array.from({ length: 20 }, () => makeTimeline({ items: [{ frames: 120 }] }));

describe('render.exportBatch', () => {
  it('queues twenty renders at low priority, all in the batch, with each project settings', async () => {
    const timelines = twenty();
    const { bus, batch, render, store, enqueuer } = setup(timelines);
    const first = timelines[0]!;
    unwrap(await bus.dispatch(render.setExportPreset, { projectId: first.projectId, presetId: 'reels' }, UI));
    const batchId = newId<'RenderBatch'>();
    const items = timelines.map((timeline) => ({ projectId: timeline.projectId, timelineId: timeline.id }));
    const receipt = unwrap(
      await bus.dispatch(batch.exportBatch, { batchId, items, mode: 'export', notify: true }, UI),
    );
    expect(receipt.undoable).toBe(false);
    expect(receipt.result.renderIds).toHaveLength(20);
    const rows = unwrap(await store.list({ batchId }));
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.batchId === batchId && row.notify)).toBe(true);
    expect(store.records.get(receipt.result.renderIds[0]!)!.presetId).toBe('reels');
    expect(store.records.get(receipt.result.renderIds[1]!)!.presetId).toBe('device');
    const exports = enqueuer.requests.filter((request) => request.kind === 'render.export');
    expect(exports).toHaveLength(20);
    expect(exports.every((request) => request.priority === 'low')).toBe(true);
  });

  it('a retry of the same batch dedupes; a draft batch announces nothing', async () => {
    const timelines = twenty().slice(0, 3);
    const { bus, batch, store } = setup(timelines);
    const batchId = newId<'RenderBatch'>();
    const items = timelines.map((timeline) => ({ projectId: timeline.projectId, timelineId: timeline.id }));
    const payload = { batchId, items, mode: 'draft' as const, notify: true };
    const once = unwrap(await bus.dispatch(batch.exportBatch, payload, UI)).result;
    const again = unwrap(await bus.dispatch(batch.exportBatch, payload, UI)).result;
    expect(again.renderIds).toEqual(once.renderIds);
    expect(unwrap(await store.list({ batchId })).every((row) => !row.notify)).toBe(true);
  });

  it('refuses the batch before queueing anything when one timeline is missing', async () => {
    const timelines = twenty().slice(0, 2);
    const { bus, batch, store } = setup(timelines);
    const items = [
      ...timelines.map((timeline) => ({ projectId: timeline.projectId, timelineId: timeline.id })),
      { projectId: timelines[0]!.projectId, timelineId: newId<'Timeline'>() },
    ];
    const refused = await bus.dispatch(
      batch.exportBatch,
      { batchId: newId<'RenderBatch'>(), items, mode: 'export' },
      UI,
    );
    expect(refused.ok).toBe(false);
    expect(store.records.size).toBe(0);
  });

  it('cancelBatch at the eighth cancels the twelve still waiting', async () => {
    const timelines = twenty();
    const { bus, batch, store } = setup(timelines);
    const batchId = newId<'RenderBatch'>();
    const items = timelines.map((timeline) => ({ projectId: timeline.projectId, timelineId: timeline.id }));
    const { renderIds } = unwrap(
      await bus.dispatch(batch.exportBatch, { batchId, items, mode: 'export' }, UI),
    ).result;
    for (const id of renderIds.slice(0, 7)) await store.update(id, { status: 'ready', finishedAt: 2_000 });
    await store.update(renderIds[7]!, { status: 'rendering' });
    const cancelled = unwrap(await bus.dispatch(batch.cancelBatch, { batchId }, UI)).result;
    expect(cancelled.cancelled).toHaveLength(13);
    const progress = foldBatch(batchId, unwrap(await store.list({ batchId })));
    expect(progress).toMatchObject({ total: 20, ready: 7, cancelled: 13, queued: 0, running: 0, etaMs: 0 });
  });
});

describe('foldBatch', () => {
  it('counts states and estimates the time left from the finished renders', () => {
    const batchId = newId<'RenderBatch'>();
    const row = (status: 'queued' | 'rendering' | 'ready', finishedAt: number | null, etaMs?: number) => ({
      status,
      createdAt: 0,
      finishedAt,
      progress: etaMs === undefined ? null : { fraction: 0.5, etaMs },
    });
    const progress = foldBatch(batchId, [
      row('ready', 10_000),
      row('ready', 20_000),
      row('rendering', null, 4_000),
      row('queued', null),
    ]);
    // 10 s per finished render: the running one's 4 s plus one queued render.
    expect(progress).toEqual({
      batchId,
      total: 4,
      queued: 1,
      running: 1,
      ready: 2,
      needsAttention: 0,
      failed: 0,
      cancelled: 0,
      etaMs: 14_000,
    });
    expect(foldBatch(batchId, [row('queued', null)]).etaMs).toBeNull();
  });
});
