// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render job kinds as SPEC section 4 sets them, and the export handler:
 * progress and the signal reach the worker, and a render cancelled in the
 * store stops its export whether it was waiting or running.
 */
import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CancelledError,
  err,
  newId,
  ok,
  type JobContext,
  type JobProgress,
  type ProjectId,
  type RenderId,
  type RenderWorker,
} from '@taalcut/core';
import {
  createRenderJobs,
  renderExportJob,
  renderExportJobKey,
  renderPurgeJob,
  renderPurgeJobKey,
} from '../../src/jobs/render-jobs';
import { renderRow } from '../commands/support';
import { tempDir } from '../support/media';
import { memoryRenderStore } from '../support/render-store';

const project: ProjectId = newId<'Project'>();
const folders = { conform: '/nowhere/conform', work: '/nowhere/work', preview: '/nowhere/preview' };
const clock = { now: () => 1_000 };

function context(): JobContext & { progressed: JobProgress[]; controller: AbortController } {
  const controller = new AbortController();
  const progressed: JobProgress[] = [];
  return {
    jobId: newId<'Job'>(),
    projectId: project,
    attempt: 1,
    signal: controller.signal,
    progress: (progress) => progressed.push(progress),
    progressed,
    controller,
  };
}

/** A worker whose export reports progress, then waits until aborted or released. */
function slowWorker() {
  const calls: { signal: AbortSignal | undefined }[] = [];
  let release: () => void = () => undefined;
  const worker: RenderWorker = {
    async export(input, options) {
      calls.push({ signal: options?.signal });
      options?.onProgress?.({ fraction: 0.5, stageKey: 'jobs.stage.render.capturing' });
      await new Promise<void>((resolve) => {
        release = resolve;
        options?.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      if (options?.signal?.aborted) return err(CancelledError());
      return ok({ renderId: input.renderId as RenderId, status: 'needsAttention', qa: null });
    },
    captureFrame: async () => err(CancelledError()),
  };
  return { worker, calls, release: () => release() };
}

const exportHandler = (jobs: ReturnType<typeof createRenderJobs>) =>
  jobs.find((job) => job.kind.kind === 'render.export')!;

describe('render job kinds', () => {
  it('match the SPEC', () => {
    expect(renderExportJob).toMatchObject({
      kind: 'render.export',
      resource: 'gpu',
      priority: 'normal',
      timeoutMs: 30 * 60_000,
      resumable: true,
      retry: { maxAttempts: 2 },
    });
    const renderId = newId<'Render'>();
    const request = {
      projectId: project,
      timelineId: newId<'Timeline'>(),
      presetId: 'device' as const,
      captions: { burnIn: true, sidecars: [] },
      notify: false,
      contentCredentials: { add: false },
      includeBumpers: true,
    };
    expect(renderExportJob.idempotencyKey!({ renderId, request })).toBe(renderExportJobKey(renderId));
    expect(renderExportJobKey(renderId)).toMatch(/^[0-9a-f]{64}$/);
    expect(renderPurgeJob).toMatchObject({
      kind: 'render.purge',
      resource: 'io',
      priority: 'low',
      retry: { maxAttempts: 1 },
    });
    expect(renderPurgeJobKey(Date.UTC(2026, 9, 13, 23))).toBe('render.purge:2026-10-13');
  });
});

describe('the render.export handler', () => {
  it('passes progress and the signal through, and returns the worker’s output', async () => {
    const { worker, calls, release } = slowWorker();
    const jobs = createRenderJobs({ worker, folders, clock });
    const ctx = context();
    const row = renderRow({ projectId: project });
    const running = exportHandler(jobs).handler({ renderId: row.id, request: row.request }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 5));
    release();
    const result = await running;
    expect(result).toEqual(ok({ renderId: row.id, status: 'needsAttention', qa: null }));
    expect(ctx.progressed).toEqual([{ fraction: 0.5, stageKey: 'jobs.stage.render.capturing' }]);
    expect(calls[0]!.signal).toBeDefined();
  });

  it('aborts the worker when the job is cancelled', async () => {
    const { worker, calls } = slowWorker();
    const ctx = context();
    const row = renderRow({ projectId: project });
    const running = exportHandler(createRenderJobs({ worker, folders, clock })).handler(
      { renderId: row.id, request: row.request },
      ctx,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    ctx.controller.abort();
    const result = await running;
    expect(result.ok ? null : result.error.code).toBe('core.cancelled');
    expect(calls[0]!.signal!.aborted).toBe(true);
  });

  it('never starts a render cancelled while queued, and stops one cancelled while running', async () => {
    const store = memoryRenderStore();
    const { worker, calls } = slowWorker();
    const jobs = createRenderJobs({ worker, folders, clock, store, cancelPollMs: 5 });
    const queued = renderRow({ projectId: project, status: 'cancelled' });
    store.records.set(queued.id, queued);
    const skipped = await exportHandler(jobs).handler(
      { renderId: queued.id, request: queued.request },
      context(),
    );
    expect(skipped.ok ? null : skipped.error.code).toBe('core.cancelled');
    expect(calls).toHaveLength(0);

    const running = renderRow({ projectId: project, status: 'rendering' });
    store.records.set(running.id, running);
    const run = exportHandler(jobs).handler({ renderId: running.id, request: running.request }, context());
    await new Promise((resolve) => setTimeout(resolve, 10));
    await store.update(running.id, { status: 'cancelled' });
    const stopped = await run;
    expect(stopped.ok ? null : stopped.error.code).toBe('core.cancelled');
    expect(calls[0]!.signal!.aborted).toBe(true);
  });
});

describe('the render.purge handler', () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => {
    work = await tempDir('render-purge');
  });
  afterEach(() => work.dispose());

  it('keeps the work folders of running and needsAttention renders', async () => {
    const store = memoryRenderStore();
    const dirs = {
      conform: join(work.dir, 'conform'),
      work: join(work.dir, 'work'),
      preview: join(work.dir, 'preview'),
    };
    const waiting = renderRow({ projectId: project, status: 'needsAttention' });
    const done = renderRow({ projectId: project, status: 'ready' });
    store.records.set(waiting.id, waiting);
    store.records.set(done.id, done);
    const old = new Date(Date.now() - 48 * 3_600_000);
    for (const id of [waiting.id, done.id]) {
      await mkdir(join(dirs.work, id), { recursive: true });
      await writeFile(join(dirs.work, id, 'final.mp4'), 'x');
      await utimes(join(dirs.work, id), old, old);
    }
    const { worker } = slowWorker();
    const purge = createRenderJobs({ worker, folders: dirs, clock: { now: () => Date.now() }, store }).find(
      (job) => job.kind.kind === 'render.purge',
    )!;
    const result = await purge.handler({}, context());
    expect(result).toEqual(ok({ removed: 1, freedBytes: 1 }));
    expect(await readdir(dirs.work)).toEqual([waiting.id]);
  });
});
