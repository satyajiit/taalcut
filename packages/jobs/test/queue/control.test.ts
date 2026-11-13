// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Done when: pause and resume work through the engine API (per job and for the whole queue). */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createJobEngine, defineJob, MemoryJobStore } from '../../src/index';
import { deferred, sleep, testEngine, waitFor } from './helpers';

/** A job that runs until aborted or released by the test. */
function blockingJob(kind = 'test.block') {
  const started: string[] = [];
  const aborted: string[] = [];
  const gate = deferred();
  const definition = defineJob({
    kind,
    resourceClass: 'cpu',
    handler: async (payload: { name: string }, signal) => {
      started.push(payload.name);
      await new Promise<void>((resolve, reject) => {
        void gate.promise.then(resolve);
        signal.addEventListener('abort', () => {
          aborted.push(payload.name);
          reject(signal.reason);
        });
      });
      return payload.name;
    },
  });
  return { definition, started, aborted, finish: gate.resolve };
}

describe('job engine: pause, resume, cancel', () => {
  it('pauses a running job (aborting it, keeping the attempt) and resumes it', async () => {
    const { engine, store, ofType } = testEngine();
    const job = blockingJob();
    engine.register(job.definition);
    await engine.start();
    const { id } = unwrap(await engine.enqueue(job.definition, { name: 'a' })).job;
    await waitFor(() => job.started.length === 1);

    const paused = unwrap(await engine.pause(id));
    expect(paused).toMatchObject({ state: 'paused', attempts: 0 });
    await waitFor(() => engine.running().length === 0, 1000, 'abort');
    expect(job.aborted).toEqual(['a']);
    await sleep(60);
    expect(job.started).toHaveLength(1); // stays paused

    job.finish();
    unwrap(await engine.resume(id));
    await engine.whenIdle();
    expect(unwrap(store.get(id))).toMatchObject({ state: 'succeeded', attempts: 1, result: 'a' });
    expect(ofType('job.paused')).toHaveLength(1);
    expect(ofType('job.resumed')).toHaveLength(1);
    expect((await engine.resume(id)).ok).toBe(false); // not paused any more
  });

  it('pauses a queued job before it starts', async () => {
    const { engine, store } = testEngine();
    const job = blockingJob();
    engine.register(job.definition);
    const { id } = unwrap(await engine.enqueue(job.definition, { name: 'later' })).job;
    unwrap(await engine.pause(id));
    await engine.start();
    await sleep(50);
    expect(job.started).toEqual([]);
    expect(unwrap(store.get(id)).state).toBe('paused');
  });

  it('cancels a running job', async () => {
    const { engine, store, ofType } = testEngine();
    const job = blockingJob();
    engine.register(job.definition);
    await engine.start();
    const { id } = unwrap(await engine.enqueue(job.definition, { name: 'x' })).job;
    await waitFor(() => job.started.length === 1);
    unwrap(await engine.cancel(id));
    await engine.whenIdle();
    expect(unwrap(store.get(id)).state).toBe('cancelled');
    expect(job.aborted).toEqual(['x']);
    expect(ofType('job.cancelled')).toHaveLength(1);
    expect((await engine.cancel(id)).ok).toBe(false);
  });

  it('pauses and resumes the whole queue, handing running jobs back', async () => {
    const { engine, store, ofType } = testEngine({ concurrency: { cpu: 2 } });
    const job = blockingJob();
    engine.register(job.definition);
    await engine.start();
    for (const name of ['a', 'b', 'c']) await engine.enqueue(job.definition, { name });
    await waitFor(() => job.started.length === 2);

    await engine.pauseAll();
    expect(engine.paused).toBe(true);
    expect(engine.running()).toEqual([]);
    expect(store.list({ states: ['queued'] })).toHaveLength(3);
    expect(store.list().every((j) => j.attempts === 0)).toBe(true); // released, not failed
    expect(ofType('job.released').map((e) => e.reason)).toEqual(['queue_paused', 'queue_paused']);
    await sleep(60);
    expect(job.started).toHaveLength(2); // nothing new starts while paused
    await engine.pauseAll(); // idempotent

    job.finish();
    engine.resumeAll();
    engine.resumeAll();
    await engine.whenIdle();
    expect(store.list({ states: ['succeeded'] })).toHaveLength(3);
    expect(ofType('queue.paused')).toHaveLength(1);
    expect(ofType('queue.resumed')).toHaveLength(1);
  });

  it('can start paused (a remembered setting)', async () => {
    const { engine, store } = testEngine({ startPaused: true });
    engine.register(defineJob({ kind: 'test.quick', resourceClass: 'io', handler: async () => 1 }));
    await engine.start();
    await engine.enqueue('test.quick', {});
    await sleep(50);
    expect(store.list({ states: ['queued'] })).toHaveLength(1);
    engine.resumeAll();
    await engine.whenIdle();
    expect(store.list({ states: ['succeeded'] })).toHaveLength(1);
  });
});

describe('job engine: graceful shutdown', () => {
  it('lets running jobs finish within the grace period', async () => {
    const { engine, store } = testEngine();
    engine.register(
      defineJob({
        kind: 'test.short',
        resourceClass: 'cpu',
        handler: async () => sleep(30).then(() => 'ok'),
      }),
    );
    await engine.start();
    const { id } = unwrap(await engine.enqueue('test.short', {})).job;
    await waitFor(() => engine.running().length === 1);
    await engine.stop({ graceMs: 1000 });
    expect(unwrap(store.get(id)).state).toBe('succeeded');
    await engine.stop(); // no-op
    await expect(engine.start()).rejects.toThrow(/cannot be restarted/);
  });

  it('aborts and releases jobs still running after the grace period, even ones that ignore the signal', async () => {
    const store = new MemoryJobStore();
    const engine = createJobEngine({ store, leaseMs: 1000, pollMs: 10 });
    const polite = blockingJob('test.polite');
    engine.register(polite.definition);
    engine.register(
      defineJob({
        kind: 'test.stubborn',
        resourceClass: 'io',
        handler: () => new Promise<never>(() => undefined),
      }),
    );
    await engine.start();
    const a = unwrap(await engine.enqueue('test.polite', { name: 'polite' })).job;
    const b = unwrap(await engine.enqueue('test.stubborn', {})).job;
    await waitFor(() => engine.running().length === 2);
    const t0 = Date.now();
    await engine.stop({ graceMs: 20 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(polite.aborted).toEqual(['polite']);
    for (const id of [a.id, b.id])
      expect(unwrap(store.get(id))).toMatchObject({ state: 'queued', attempts: 0, leaseOwner: null });
  });
});
