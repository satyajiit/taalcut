// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The render worker and the job enqueue contract across processes (P2-M6, P2-M8). */
import { describe, expect, it } from 'vitest';
import {
  connectRpc,
  err,
  FrameRates,
  jobEnqueueContract,
  jobEnqueuerOverRpc,
  jobEnqueueRouter,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  renderWorkerContract,
  renderWorkerOverRpc,
  renderWorkerRouter,
  serveRpc,
  type JobId,
  type JobProgress,
  type JobRequest,
  type PublicJobSnapshot,
  type RenderWorker,
} from '@taalcut/core';
import { channel } from './helpers/ports';

const renderId = newId<'Render'>();
const request = {
  renderId,
  request: {
    projectId: newId<'Project'>(),
    timelineId: newId<'Timeline'>(),
    presetId: 'reels' as const,
    captions: { burnIn: true, sidecars: [] },
  },
};
const frame = {
  projectId: request.request.projectId,
  timelineId: request.request.timelineId,
  frame: 30,
  source: { kind: 'preview' as const },
};

function fakeWorker(output: unknown = { renderId, status: 'ready', qa: null }): RenderWorker {
  return {
    async export(_input, options) {
      options?.onProgress?.({ fraction: 0.5, stageKey: 'jobs.stage.render.encoding' });
      return ok(output as never);
    },
    async captureFrame(input) {
      if (input.frame > 1000) return err(NotFoundError({ entity: 'frame' }));
      return ok({
        frame: input.frame,
        at: RationalTime.of(input.frame, FrameRates.fps30),
        mimeType: 'image/jpeg',
        dataBase64: 'AAAA',
        width: 432,
        height: 768,
        visible: { clips: ['c1'], captions: [], texts: [] },
        textBoxes: [],
      });
    },
  };
}

function connect(worker: RenderWorker) {
  const { port1, port2 } = channel();
  serveRpc(renderWorkerRouter(worker), port1, { context: {} });
  const client = connectRpc(renderWorkerContract, port2, { peer: 'render' }).client;
  return renderWorkerOverRpc(() => client);
}

describe('render worker over IPC', () => {
  it('streams progress, then the export output', async () => {
    const progress: JobProgress[] = [];
    const remote = connect(fakeWorker());
    const result = await remote.export(request, { onProgress: (p) => progress.push(p) });
    expect(result).toEqual({ ok: true, value: { renderId, status: 'ready', qa: null } });
    expect(progress).toEqual([{ fraction: 0.5, stageKey: 'jobs.stage.render.encoding' }]);
  });

  it('refuses an output that is not an export result', async () => {
    const remote = connect(fakeWorker({ renderId, status: 'done' }));
    expect(await remote.export(request)).toMatchObject({ ok: false, error: { code: 'core.validation' } });
  });

  it('captures a frame, and reports a missing one as a value', async () => {
    const remote = connect(fakeWorker());
    const captured = await remote.captureFrame(frame);
    expect(captured.ok && captured.value.width).toBe(432);
    expect(await remote.captureFrame({ ...frame, frame: 5000 })).toMatchObject({
      ok: false,
      error: { code: 'core.not_found' },
    });
  });

  it('is cancelled before calling when the signal already fired', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await connect(fakeWorker()).export(request, { signal: controller.signal })).toMatchObject({
      ok: false,
      error: { code: 'core.cancelled' },
    });
  });
});

describe('job enqueue over IPC', () => {
  it('enqueues and cancels through the queue and returns the public snapshot', async () => {
    const seen: JobRequest[] = [];
    const jobs = new Map<JobId, PublicJobSnapshot>();
    const queue = {
      async cancel(id: JobId) {
        const job = jobs.get(id);
        return job ? ok({ ...job, state: 'cancelled' as const }) : err(NotFoundError({ entity: 'job', id }));
      },
      async enqueue(job: JobRequest) {
        seen.push(job);
        const snapshot: PublicJobSnapshot = {
          id: newId<'Job'>(),
          kind: job.kind,
          state: 'queued',
          priority: 'normal',
          resource: 'video',
          projectId: null,
          idempotencyKey: job.idempotencyKey ?? null,
          parentId: null,
          attempt: 1,
          maxAttempts: 3,
          progress: null,
          error: null,
          createdAt: 1,
          updatedAt: 1,
          startedAt: null,
          finishedAt: null,
          nextAttemptAt: null,
        };
        jobs.set(snapshot.id, snapshot);
        return ok(snapshot);
      },
    };
    const { port1, port2 } = channel();
    serveRpc(jobEnqueueRouter(queue), port1, { context: {} });
    const client = connectRpc(jobEnqueueContract, port2, { peer: 'jobs' }).client;
    const enqueuer = jobEnqueuerOverRpc(() => client);
    const result = await enqueuer.enqueue({ kind: 'render.export', input: request, idempotencyKey: 'k1' });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'render.export', resource: 'video', state: 'queued' },
    });
    expect(seen).toEqual([{ kind: 'render.export', input: request, idempotencyKey: 'k1' }]);
    expect(await enqueuer.enqueue({ kind: 'Bad Kind', input: {} })).toMatchObject({
      ok: false,
      error: { code: 'core.validation' },
    });
    if (!result.ok) return;
    expect(await enqueuer.cancel?.(result.value.id)).toMatchObject({
      ok: true,
      value: { state: 'cancelled' },
    });
    expect(await enqueuer.cancel?.(newId<'Job'>())).toMatchObject({
      ok: false,
      error: { code: 'core.not_found' },
    });
  });
});
