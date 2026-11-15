// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// FIX-LOSTRENDER: a render whose export job ended without it is settled, never left "queued". The owner,
// 2026-11-15: a draft the agent's tool gave up on stayed at "Waiting to start" for good, because the queue had
// cancelled its job and the render process had put the row back to `queued` for a job that would take it over.
import { describe, expect, it } from 'vitest';
import { CancelledError, err, newId, ok, TimeoutError, type JobContext, type ProjectId } from '@taalcut/core';
import type { RenderId, RenderWorker } from '@taalcut/core';
import { LOST_RENDER_GRACE_MS, settleEndedExport, settleLostRenders } from '../../src/jobs/lost-renders';
import { createRenderJobs } from '../../src/jobs/render-jobs';
import { renderRow } from '../commands/support';
import { memoryRenderStore } from '../support/render-store';

const project: ProjectId = newId<'Project'>();
const NOW = 10 * LOST_RENDER_GRACE_MS;
const clock = { now: () => NOW };
const folders = { conform: '/nowhere/conform', work: '/nowhere/work', preview: '/nowhere/preview' };

function seeded(status: Parameters<typeof renderRow>[0]['status'], createdAt = 1_000) {
  const store = memoryRenderStore();
  const row = { ...renderRow({ projectId: project, status }), createdAt };
  store.records.set(row.id, row);
  return { store, row };
}

describe('a render whose export job ended for good', () => {
  it('is stopped when the job was cancelled, and keeps the reason when it failed', async () => {
    const cancelled = seeded('queued');
    expect(
      await settleEndedExport({ ...cancelled, clock }, cancelled.row.id, { state: 'cancelled' }),
    ).toEqual(ok(true));
    expect(cancelled.store.records.get(cancelled.row.id)).toMatchObject({
      status: 'cancelled',
      finishedAt: NOW,
    });

    const failed = seeded('rendering');
    const error = TimeoutError({ ms: 1_800_000 }, { detail: 'a path the window must not see' });
    expect(await settleEndedExport({ ...failed, clock }, failed.row.id, { state: 'failed', error })).toEqual(
      ok(true),
    );
    const stored = failed.store.records.get(failed.row.id)!;
    expect(stored).toMatchObject({ status: 'failed', finishedAt: NOW, error: { code: 'core.timeout' } });
    expect(stored.error).not.toHaveProperty('detail');
  });

  it('is left as the render process settled it, and a render that is gone changes nothing', async () => {
    for (const status of ['ready', 'needsAttention', 'failed', 'cancelled'] as const) {
      const { store, row } = seeded(status);
      expect(await settleEndedExport({ store, clock }, row.id, { state: 'cancelled' })).toEqual(ok(false));
      expect(store.records.get(row.id)?.status).toBe(status);
      expect(store.updates).toHaveLength(0);
    }
    const { store } = seeded('queued');
    expect(await settleEndedExport({ store, clock }, newId<'Render'>(), { state: 'cancelled' })).toEqual(
      ok(false),
    );
  });
});

describe('the start sweep', () => {
  it('stops every waiting or running render with no export job left, and nothing else', async () => {
    const store = memoryRenderStore();
    const put = (status: Parameters<typeof renderRow>[0]['status'], createdAt = 1_000) => {
      const row = { ...renderRow({ projectId: project, status }), createdAt };
      store.records.set(row.id, row);
      return row.id;
    };
    const lost = [put('queued'), put('rendering'), put('checking'), put('fixing')];
    const live = put('queued');
    const justMade = put('queued', NOW - LOST_RENDER_GRACE_MS + 1);
    const done = [put('ready'), put('needsAttention'), put('failed'), put('cancelled')];

    const settled = await settleLostRenders({ store, clock }, new Set([live]));
    expect(settled.ok && [...settled.value].sort()).toEqual([...lost].sort());
    for (const id of lost)
      expect(store.records.get(id)).toMatchObject({ status: 'cancelled', finishedAt: NOW });
    expect(store.records.get(live)?.status).toBe('queued');
    expect(store.records.get(justMade)?.status).toBe('queued');
    expect(done.map((id) => store.records.get(id)?.status)).toEqual([
      'ready',
      'needsAttention',
      'failed',
      'cancelled',
    ]);
    // A second sweep finds nothing.
    expect(await settleLostRenders({ store, clock }, new Set([live]))).toEqual(ok([]));
  });
});

describe('an export the queue stops while it runs', () => {
  /** The render process's answer to an abort it did not ask for: the row goes back to `queued`. */
  function requeueingWorker(store: ReturnType<typeof memoryRenderStore>): RenderWorker {
    return {
      async export(input, options) {
        await new Promise<void>((resolve) =>
          options?.signal?.addEventListener('abort', () => resolve(), { once: true }),
        );
        await store.update(input.renderId as RenderId, { status: 'queued' });
        return err(CancelledError());
      },
      captureFrame: async () => err(CancelledError()),
    };
  }

  async function stopped(reason: unknown) {
    const { store, row } = seeded('rendering');
    const controller = new AbortController();
    const context: JobContext = {
      jobId: newId<'Job'>(),
      projectId: project,
      attempt: 1,
      signal: controller.signal,
      progress: () => undefined,
    };
    const jobs = createRenderJobs({ worker: requeueingWorker(store), folders, clock, store });
    const running = jobs
      .find((job) => job.kind.kind === 'render.export')!
      .handler({ renderId: row.id, request: row.request }, context);
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort(reason);
    const result = await running;
    expect(result.ok ? null : result.error.code).toBe('core.cancelled');
    return store.records.get(row.id)!;
  }

  it('is stopped for good when the job was cancelled by its id', async () => {
    const row = await stopped(CancelledError(undefined, { detail: 'cancelled' }));
    expect(row).toMatchObject({ status: 'cancelled', finishedAt: NOW });
  });

  it('waits for its next run after a pause, a quit, a lost lease or a timeout', async () => {
    for (const detail of ['paused', 'shutdown', 'queue_paused', 'lease_lost'])
      expect((await stopped(CancelledError(undefined, { detail }))).status).toBe('queued');
    expect((await stopped(TimeoutError({ ms: 1_800_000 }))).status).toBe('queued');
    expect((await stopped(undefined)).status).toBe('queued');
  });
});
