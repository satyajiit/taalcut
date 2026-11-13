// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { callRpc, newId, type RenderBatchProgress, type RenderId, type TimelineId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';

const projectId = GOLDEN_PROJECT;

function setup(renderTickMs = 0) {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs },
  });
  const dispatch = (name: string, payload: unknown) =>
    callRpc(client.commands.dispatch({ name, payload, source: 'ui' }));
  const items = (ids: readonly TimelineId[] = GOLDEN_TIMELINES) =>
    ids.map((timelineId) => ({ projectId, timelineId }));
  /** The batch's progress once it satisfies `done`. */
  const until = async (batchId: string, done: (progress: RenderBatchProgress) => boolean) => {
    const controller = new AbortController();
    const stream = await client.renders.watchBatch(
      { batchId: batchId as RenderBatchProgress['batchId'] },
      { signal: controller.signal },
    );
    for await (const progress of stream)
      if (done(progress)) {
        controller.abort();
        return progress;
      }
    throw new Error('the stream ended');
  };
  return { client, controls, dispatch, items, until };
}

describe('the batch render queue fake (P3-V16)', () => {
  it('makes one render per item and folds them into the batch’s progress', async () => {
    const s = setup();
    const batchId = newId<'RenderBatch'>();
    const before = await s.client.renders.list({ projectId });
    const sent = await s.dispatch('render.exportBatch', { batchId, items: s.items(), mode: 'export' });
    expect(sent.ok).toBe(true);
    const receipt = sent.ok ? (sent.value as { result: { batchId: string; renderIds: RenderId[] } }) : null;
    expect(receipt?.result.batchId).toBe(batchId);
    expect(receipt?.result.renderIds).toHaveLength(3);
    const after = await s.client.renders.list({ projectId });
    expect(after.length - before.length).toBe(3);
    const progress = await s.until(batchId, () => true);
    expect(progress).toMatchObject({ batchId, total: 3, ready: 0, queued: 3, running: 0, failed: 0 });
    expect(s.controls.make.p3.batch.requests.at(-1)).toMatchObject({
      batchId,
      notify: false,
      mode: 'export',
    });

    // The batch id is the caller's: a retry is the same batch, its items the renders it already made.
    const again = await s.dispatch('render.exportBatch', { batchId, items: s.items(), mode: 'export' });
    expect(again.ok && (again.value as { result: { renderIds: RenderId[] } }).result.renderIds).toEqual(
      receipt?.result.renderIds,
    );
    expect(await s.client.renders.list({ projectId })).toHaveLength(after.length);
    expect((await s.until(batchId, () => true)).total).toBe(3);
  });

  it('renders the batch to the end, one export after another', async () => {
    const s = setup(2);
    const batchId = newId<'RenderBatch'>();
    await s.dispatch('render.exportBatch', { batchId, items: s.items(), mode: 'export' });
    const done = await s.until(batchId, (progress) => progress.queued + progress.running === 0);
    expect(done).toMatchObject({ total: 3, ready: 3, etaMs: 0 });
  });

  it('refuses the whole batch when one timeline is unknown, before queuing anything', async () => {
    const s = setup();
    const before = await s.client.renders.list({ projectId });
    const refused = await s.dispatch('render.exportBatch', {
      batchId: newId<'RenderBatch'>(),
      items: [...s.items(), { projectId, timelineId: newId<'Timeline'>() }],
      mode: 'export',
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'core.not_found' } });
    expect(await s.client.renders.list({ projectId })).toHaveLength(before.length);
  });

  it('refuses an empty batch and one over fifty, as the payload’s schema does', async () => {
    const s = setup();
    const empty = await s.dispatch('render.exportBatch', { batchId: newId(), items: [], mode: 'export' });
    expect(empty.ok).toBe(false);
    const many = Array.from({ length: 51 }, () => s.items()[1]!);
    const over = await s.dispatch('render.exportBatch', { batchId: newId(), items: many, mode: 'export' });
    expect(over.ok).toBe(false);
  });

  it('a draft batch never notifies', async () => {
    const s = setup();
    const batchId = newId<'RenderBatch'>();
    const sent = await s.dispatch('render.exportBatch', {
      batchId,
      items: s.items(GOLDEN_TIMELINES.slice(1)),
      mode: 'draft',
      notify: true,
    });
    const ids = sent.ok ? (sent.value as { result: { renderIds: RenderId[] } }).result.renderIds : [];
    for (const renderId of ids) expect((await s.client.renders.get({ renderId })).notify).toBe(false);
  });

  it('Cancel the rest stops what is queued or running', async () => {
    const s = setup();
    const batchId = newId<'RenderBatch'>();
    await s.dispatch('render.exportBatch', { batchId, items: s.items(), mode: 'export' });
    const cancelled = await s.dispatch('render.cancelBatch', { batchId });
    expect(
      cancelled.ok && (cancelled.value as { result: { cancelled: RenderId[] } }).result.cancelled,
    ).toHaveLength(3);
    const progress = await s.until(batchId, () => true);
    expect(progress).toMatchObject({ cancelled: 3, queued: 0, running: 0, etaMs: 0 });
    // Nothing left to stop.
    const twice = await s.dispatch('render.cancelBatch', { batchId });
    expect(twice).toMatchObject({ ok: true, value: { result: { cancelled: [] } } });
    // An unknown batch has nothing to cancel.
    expect(await s.dispatch('render.cancelBatch', { batchId: newId() })).toMatchObject({
      ok: true,
      value: { result: { cancelled: [] } },
    });
  });

  it('a batch it never made is not found', async () => {
    const s = setup();
    await expect(s.until(newId<'RenderBatch'>(), () => true)).rejects.toMatchObject({
      data: { code: 'core.not_found' },
    });
  });
});
