// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A running job's children (round P3-3, children.ts): an export that holds the only 'gpu' slot bakes a grade
 * through the queue and finishes, because its child starts at once outside the limit; a child whose parent isn't
 * running waits for the pool like any job; a queued job matched by its key is adopted too. The link is kept in
 * memory only, and a restart doesn't need it: the jobs process dies with the export holding the only 'gpu' slot and
 * its bake queued (or running), the next process takes both over, the export runs again, asks for the same bake by
 * its key, adopts it and finishes, each running once more at most (hardening P3-B1).
 */
import { defineJobKind, ok, unwrap, type JobId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createEngineJobRunner,
  defineJob,
  fromJobKind,
  MemoryJobStore,
  type JobEngine,
} from '../../src/index';
import { deferred, testEngine, waitFor } from './helpers';

const bakeKind = defineJobKind({
  kind: 'test.bake',
  input: z.object({ clip: z.string() }),
  output: z.object({ cube: z.string() }),
  resource: 'gpu',
  priority: 'normal',
  retry: { maxAttempts: 1, backoff: { kind: 'fixed', delayMs: 10 } },
  idempotencyKey: (input) => `bake:${input.clip}`,
});

const bake = fromJobKind(bakeKind, async (input) => ok({ cube: `${input.clip}.cube` }));

/** A 'gpu' export that bakes its clip through the engine's runner, as its child. */
function exportJob(engine: JobEngine, started?: (jobId: JobId) => void) {
  const runner = createEngineJobRunner(engine);
  return defineJob({
    kind: 'test.export',
    resourceClass: 'gpu',
    payload: z.object({ clip: z.string() }),
    handler: async ({ clip }, signal, _progress, context) => {
      started?.(context.jobId);
      const baked = await runner.run(bakeKind, { clip }, { signal, parentJobId: context.jobId });
      return baked.ok ? { file: `${clip}.mp4`, cube: baked.value.cube } : baked;
    },
  });
}

describe('child jobs', () => {
  it('runs a gpu child of a gpu parent at limit 1, and the parent finishes', async () => {
    const { engine, store, ofType } = testEngine({ concurrency: { gpu: 1 } });
    engine.register(bake);
    engine.register(exportJob(engine));
    await engine.start();
    const { job } = unwrap(await engine.enqueue('test.export', { clip: 'a' }));
    await waitFor(() => unwrap(store.get(job.id)).state === 'succeeded', 5000, 'the export to finish');
    expect(unwrap(store.get(job.id)).result).toEqual({ file: 'a.mp4', cube: 'a.cube' });
    // The bake started while its parent held the slot.
    const started = ofType('job.started').map((event) => event.job.kind);
    expect(started).toEqual(['test.export', 'test.bake']);
  });

  it('queues a child whose parent is not running behind the pool', async () => {
    const { engine, store } = testEngine({ concurrency: { gpu: 1 } });
    const hold = deferred();
    engine.register(bake);
    engine.register(
      defineJob({
        kind: 'test.hold',
        resourceClass: 'gpu',
        handler: async () => hold.promise.then(() => 'held'),
      }),
    );
    await engine.start();
    const held = unwrap(await engine.enqueue('test.hold', {}));
    await waitFor(() => unwrap(store.get(held.job.id)).state === 'running', 5000, 'the hold to start');
    // A parent id that isn't running here: an ordinary job, which waits for the slot.
    const { job: parent } = unwrap(await engine.enqueue('test.hold', {}));
    const { job: child } = unwrap(
      await engine.enqueue('test.bake', { clip: 'b' }, { parentJobId: parent.id }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(unwrap(store.get(child.id)).state).toBe('queued');
    hold.resolve();
    await waitFor(() => unwrap(store.get(child.id)).state === 'succeeded', 5000, 'the child to run');
  });

  it('adopts a queued job its key matches, so the parent no longer waits for itself', async () => {
    const { engine, store } = testEngine({ concurrency: { gpu: 1 } });
    const exportStarted = deferred<JobId>();
    engine.register(bake);
    engine.register(exportJob(engine, (jobId) => exportStarted.resolve(jobId)));
    // The bake is already queued (an earlier run asked for it) before the export holds the slot.
    const queued = unwrap(await engine.enqueue(bakeKind.kind, { clip: 'c' }, { idempotencyKey: 'bake:c' }));
    const { job } = unwrap(await engine.enqueue('test.export', { clip: 'c' }, { priority: 10 }));
    await engine.start();
    expect(await exportStarted.promise).toBe(job.id);
    await waitFor(() => unwrap(store.get(job.id)).state === 'succeeded', 5000, 'the export to finish');
    expect(unwrap(store.get(queued.job.id)).state).toBe('succeeded');
    expect(unwrap(store.get(job.id)).result).toEqual({ file: 'c.mp4', cube: 'c.cube' });
  });
});

describe('child jobs after a restart', () => {
  /** What a jobs process left when it died: the export claimed (running), its bake queued or claimed too. */
  function leftByDeadProcess(bakeRunning: boolean) {
    const store = new MemoryJobStore();
    const lease = { owner: 'jobs:dead', leaseMs: 10 * 60_000 };
    const parent = unwrap(
      store.enqueue({ kind: 'test.export', payload: { clip: 'r' }, resourceClass: 'gpu', priority: 10 }),
    ).job;
    unwrap(store.claimNext({ ...lease, kinds: ['test.export'] }));
    const child = unwrap(
      store.enqueue({
        kind: bakeKind.kind,
        payload: { clip: 'r' },
        resourceClass: 'gpu',
        idempotencyKey: 'bake:r',
      }),
    ).job;
    if (bakeRunning) unwrap(store.claimNext({ ...lease, kinds: [bakeKind.kind] }));
    return { store, parent, child };
  }

  for (const bakeRunning of [false, true]) {
    it(`finishes the export at limit 1 when its bake was ${bakeRunning ? 'running' : 'queued'}`, async () => {
      const { store, parent, child } = leftByDeadProcess(bakeRunning);
      const { engine, ofType } = testEngine({
        store,
        exclusive: true,
        concurrency: { gpu: 1 },
        log: () => {},
      });
      engine.register(bake);
      engine.register(exportJob(engine));
      await engine.start();
      await waitFor(() => unwrap(store.get(parent.id)).state === 'succeeded', 5000, 'the export to finish');
      expect(unwrap(store.get(parent.id)).result).toEqual({ file: 'r.mp4', cube: 'r.cube' });
      // The export asked for the same bake by its key: no second bake job, and each ran once here.
      expect(
        store
          .snapshot()
          .filter((job) => job.kind === bakeKind.kind)
          .map((job) => job.id),
      ).toEqual([child.id]);
      expect(unwrap(store.get(child.id)).state).toBe('succeeded');
      // The worst order: the export took the only slot first, so its bake could only run as its adopted child.
      const started = ofType('job.started').map((event) => event.job.kind);
      expect(started).toEqual(['test.export', bakeKind.kind]);
    });
  }
});
