// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V16 Done when (SPEC P3.6): twenty two-second timelines go out in one `render.exportBatch`. The batch's
 * twenty `render.export` jobs run through render's job handler on the real engine, one at a time as the
 * queue's `gpu` resource runs them (gpu-queue.ts): every render is checked by QA before it is delivered (gate
 * criterion 4), never more than one capture is open at once, and `renders.watchBatch` folds the rows to twenty
 * ready. A second batch cancelled while its ninth render captures stops there: eight delivered, the running
 * one and the eleven queued cancelled, one `render.finished` each, and nothing queued runs after the cancel.
 */
import { MessageChannel } from 'node:worker_threads';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectRpc,
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  FrameRate,
  newId,
  rendersContract,
  serveRpc,
  systemClock,
  unwrap,
  type CommandOrigin,
  type RenderBatchId,
  type RenderBatchProgress,
  type RenderRecord,
  type Timeline,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { createBatchCommands } from '../../src/batch/batch-commands';
import { batchProgress } from '../../src/batch/batch-progress';
import { createRenderEngine, type RenderEngine } from '../../src/engine/engine';
import { stageKey } from '../../src/engine/progress';
import { createRenderJobs } from '../../src/jobs/render-jobs';
import { DELIVERABLE_VERDICTS } from '../../src/qa/verdict';
import { movingClip, testEngine, type TestEngine } from '../support/engine';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';
import { captureWindows, gpuQueue, maxOverlap, type GpuQueue } from './gpu-queue';

const media = await findTestMedia('batch');
const shell = findTestShell('batch');
const rate = FrameRate.of(30);
const UI: CommandOrigin = { source: 'ui', actor: 'user' };
const CAPTURING = stageKey('capturing');

describe.skipIf(!media.binaries || !shell.path)('batch render queue (P3-V16)', { timeout: 1_800_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let test: TestEngine;
  let engine: RenderEngine;
  let clip: string;
  const ports: MessageChannel[] = [];

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('batch');
    clip = join(work.dir, 'moving.mp4');
    await movingClip(ctx, clip, { frames: 90, rate: '30' });
    test = testEngine(join(work.dir, 'engine'), ctx, shell.path!);
    engine = createRenderEngine(test.deps, { sweepMs: 0 });
  });
  afterAll(async () => {
    for (const channel of ports) {
      channel.port1.close();
      channel.port2.close();
    }
    await engine?.dispose();
    await work?.dispose();
  });

  /** Twenty two-second timelines, each its own project, on the shared clip. */
  function twenty(): Timeline[] {
    return Array.from({ length: 20 }, (_, index) => {
      const assetId = newId<'Asset'>();
      test.assets.set(assetId, clip);
      const timeline = {
        ...makeTimeline({
          rate,
          items: [{ frames: 60, assetId, sourceStart: 0, mediaFrames: 90, mediaRate: rate }],
        }),
        name: `Batch ${index + 1}`,
      };
      test.timelines.set(timeline.id, timeline);
      return timeline;
    });
  }

  /** The batch commands over the engine's store, the jobs on a gpu queue running render's handler. */
  function batchWorld() {
    const queue: GpuQueue = gpuQueue(
      createRenderJobs({
        worker: engine.worker,
        folders: test.deps.folders,
        clock: systemClock,
        store: test.store,
        cancelPollMs: 100,
      }),
    );
    const deps = {
      store: test.store,
      enqueuer: queue,
      timelines: test.deps.timelines,
      settings: createMemorySettingsStore(),
      clock: systemClock,
      events: test.deps.events,
    };
    const commands = createBatchCommands(deps);
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(1_000) });
    bus.register(...commands.all);
    return { queue, bus, commands };
  }

  /** `renders.watchBatch` over a real IPC port, every value it yields kept until `stop`. */
  async function watch(batchId: RenderBatchId) {
    const channel = new MessageChannel();
    ports.push(channel);
    serveRpc(engine.renders, channel.port1, { context: {} });
    const client = connectRpc(rendersContract, channel.port2, { peer: 'render' }).client;
    const controller = new AbortController();
    const seen: RenderBatchProgress[] = [];
    const stream = await client.watchBatch({ batchId }, { signal: controller.signal });
    const reading = (async () => {
      for await (const progress of stream) seen.push(progress);
    })().catch(() => undefined);
    return {
      seen,
      async stop() {
        controller.abort();
        await reading;
      },
    };
  }

  const rowsOf = (batchId: RenderBatchId): RenderRecord[] =>
    [...test.store.records.values()].filter((record) => record.batchId === batchId);
  const finishedFor = (ids: ReadonlySet<string>) =>
    test.events.filter(
      (event) =>
        event.type === 'render.finished' &&
        ids.has((event.payload as { readonly renderId: string }).renderId),
    );

  it('renders twenty timelines in one queue, one capture at a time, each through QA', async () => {
    const timelines = twenty();
    const { queue, bus, commands } = batchWorld();
    const batchId = newId<'RenderBatch'>();
    const items = timelines.map((timeline) => ({ projectId: timeline.projectId, timelineId: timeline.id }));
    const started = performance.now();
    const receipt = unwrap(
      await bus.dispatch(commands.exportBatch, { batchId, items, mode: 'export', notify: false }, UI),
    );
    expect(receipt.result.renderIds).toHaveLength(20);
    const exports = queue.jobs.filter((job) => job.request.kind === 'render.export');
    expect(exports).toHaveLength(20);
    expect(exports.every((job) => job.priority === 'low')).toBe(true);

    const watched = await watch(batchId);
    await queue.drain();
    const seconds = (performance.now() - started) / 1000;
    // Let the watch see the last write, then close it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await watched.stop();

    const rows = rowsOf(batchId);
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      // Gate criterion 4: a delivered render always has its QA report, and it let the file through.
      expect(row.status, row.name).toBe('ready');
      expect(row.qaReport, row.name).not.toBeNull();
      expect(DELIVERABLE_VERDICTS.has(row.qaReport?.verdict ?? 'needsAttention'), row.name).toBe(true);
      expect(row.filePath, row.name).not.toBeNull();
    }
    expect(exports.every((job) => job.state === 'succeeded')).toBe(true);
    const windows = captureWindows(exports, CAPTURING);
    expect(windows).toHaveLength(20);
    expect(maxOverlap(windows)).toBe(1);

    const last = watched.seen.at(-1);
    expect(last).toEqual({
      batchId,
      total: 20,
      queued: 0,
      running: 0,
      ready: 20,
      needsAttention: 0,
      failed: 0,
      cancelled: 0,
      etaMs: 0,
    });
    // The fold only moves forward: ready never drops, and every value counts twenty renders.
    expect(watched.seen.every((progress) => progress.total === 20)).toBe(true);
    expect(
      watched.seen.every(
        (value, index) => index === 0 || value.ready >= (watched.seen[index - 1]?.ready ?? 0),
      ),
    ).toBe(true);
    expect(watched.seen.some((progress) => progress.running === 1 && progress.queued > 0)).toBe(true);
    console.warn(
      `[batch] 20 renders in ${seconds.toFixed(1)} s, at most ${maxOverlap(windows)} capture open`,
    );
  });

  it('cancelled while the ninth render captures: eight delivered, the remaining twelve cancelled', async () => {
    const timelines = twenty();
    const { queue, bus, commands } = batchWorld();
    const batchId = newId<'RenderBatch'>();
    const items = timelines.map((timeline) => ({ projectId: timeline.projectId, timelineId: timeline.id }));
    unwrap(await bus.dispatch(commands.exportBatch, { batchId, items, mode: 'export', notify: false }, UI));
    const exports = queue.jobs.filter((job) => job.request.kind === 'render.export');
    const ninth = exports[8];
    let cancelledAt: number | null = null;
    await queue.drain((job, progress) => {
      if (job === ninth && progress.stageKey === CAPTURING && cancelledAt === null) {
        cancelledAt = performance.now();
        void bus.dispatch(commands.cancelBatch, { batchId }, UI);
      }
    });
    expect(cancelledAt).not.toBeNull();

    const rows = rowsOf(batchId);
    const ready = rows.filter((row) => row.status === 'ready');
    const cancelled = rows.filter((row) => row.status === 'cancelled');
    expect(ready).toHaveLength(8);
    expect(cancelled).toHaveLength(12);
    expect(ready.every((row) => row.qaReport !== null)).toBe(true);
    expect(cancelled.every((row) => row.filePath === null)).toBe(true);
    expect(exports.slice(0, 8).every((job) => job.state === 'succeeded')).toBe(true);
    expect(exports.slice(8).every((job) => job.state === 'cancelled')).toBe(true);
    // Nothing queued started after the cancel: the eleven never reported progress.
    expect(exports.slice(9).every((job) => job.progress.length === 0)).toBe(true);
    // One render.finished per cancelled render: the engine's for the running one, the command's for the queued.
    const finished = finishedFor(new Set(cancelled.map((row) => row.id)));
    expect(finished).toHaveLength(12);
    expect(
      finished.every((event) => (event.payload as { readonly status: string }).status === 'cancelled'),
    ).toBe(true);
    const progress = unwrap(await batchProgress(test.store, engine.live, batchId));
    expect(progress).toMatchObject({ total: 20, ready: 8, cancelled: 12, running: 0, queued: 0 });
  });
});
