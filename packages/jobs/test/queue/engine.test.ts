// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, TimeoutError, unwrap, ValidationError, defineError } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineJob, UnknownJobKind, type JobContext } from '../../src/index';
import { sleep, testEngine } from './helpers';

const Flaky = defineError('test.flaky', { retryable: true });
const Fatal = defineError('test.fatal');

const probe = defineJob({
  kind: 'media.probe',
  resourceClass: 'io',
  payload: z.object({ path: z.string().startsWith('/') }),
  handler: async ({ path }) => ({ path, durationMs: 1000 }),
});

describe('job engine: running jobs', () => {
  it('runs a registered handler and stores its result', async () => {
    const { engine, store, ofType } = testEngine();
    engine.register(probe);
    await engine.start();
    const { job, created } = unwrap(await engine.enqueue(probe, { path: '/a.mov' }));
    expect(created).toBe(true);
    await engine.whenIdle();
    expect(unwrap(store.get(job.id))).toMatchObject({
      state: 'succeeded',
      attempts: 1,
      progress: 1,
      result: { path: '/a.mov', durationMs: 1000 },
    });
    expect(ofType('job.enqueued')).toHaveLength(1);
    expect(ofType('job.started')[0]?.job.id).toBe(job.id);
    expect(ofType('job.succeeded')[0]?.job.state).toBe('succeeded');
  });

  it('validates payloads, knows its kinds, and enqueues each idempotency key once', async () => {
    const { engine } = testEngine();
    engine.register(probe);
    const invalid = await engine.enqueue(probe, { path: 'relative' });
    expect(!invalid.ok && ValidationError.is(invalid.error)).toBe(true);
    const unknown = await engine.enqueue('vision.embed', {});
    expect(!unknown.ok && UnknownJobKind.is(unknown.error)).toBe(true);
    const first = unwrap(
      await engine.enqueue('media.probe', { path: '/a.mov' }, { idempotencyKey: 'probe:/a.mov' }),
    );
    const second = unwrap(
      await engine.enqueue('media.probe', { path: '/a.mov' }, { idempotencyKey: 'probe:/a.mov' }),
    );
    expect(second).toEqual({ job: first.job, created: false });
    expect(() => engine.register(probe)).toThrow(/twice/);
    expect(() => defineJob({ kind: 'Bad Kind', resourceClass: 'io', handler: async () => null })).toThrow();
  });

  it('runs higher priority first', async () => {
    const order: string[] = [];
    const { engine } = testEngine({ concurrency: { cpu: 1 } });
    engine.register(
      defineJob({
        kind: 'test.order',
        resourceClass: 'cpu',
        handler: async (payload: { name: string }) => void order.push(payload.name),
      }),
    );
    await engine.enqueue('test.order', { name: 'low' }, { priority: 0 });
    await engine.enqueue('test.order', { name: 'high' }, { priority: 10 });
    await engine.enqueue('test.order', { name: 'mid' }, { priority: 5 });
    await engine.start();
    await engine.whenIdle();
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('accepts a returned Result as success or failure', async () => {
    const { engine, store } = testEngine();
    let calls = 0;
    engine.register(
      defineJob({
        kind: 'test.result',
        resourceClass: 'cpu',
        maxAttempts: 1,
        handler: async (payload: { fail: boolean }) => {
          calls++;
          return payload.fail ? err(Fatal()) : ok({ fine: true });
        },
      }),
    );
    await engine.start();
    const good = unwrap(await engine.enqueue('test.result', { fail: false })).job;
    const bad = unwrap(await engine.enqueue('test.result', { fail: true })).job;
    await engine.whenIdle();
    expect(unwrap(store.get(good.id))).toMatchObject({ state: 'succeeded', result: { fine: true } });
    expect(unwrap(store.get(bad.id))).toMatchObject({ state: 'failed', error: { code: 'test.fatal' } });
    expect(calls).toBe(2);
  });

  it('retries retryable failures with growing backoff, then succeeds', async () => {
    const { engine, ofType } = testEngine({ backoff: { baseMs: 20, factor: 2, jitter: 0 } });
    const times: number[] = [];
    engine.register(
      defineJob({
        kind: 'test.flaky',
        resourceClass: 'network',
        maxAttempts: 4,
        handler: async (_: object, _signal, _progress, context: JobContext) => {
          times.push(Date.now());
          if (context.attempt < 3) throw Flaky();
          return 'done';
        },
      }),
    );
    await engine.start();
    const { job } = unwrap(await engine.enqueue('test.flaky', {}));
    // On the job's own outcome, not a clock: whenIdle() is satisfied while a retry waits for its backoff (it is
    // not due yet), and a loaded machine can take longer than any fixed sleep to reach the third attempt.
    expect(unwrap(await engine.wait(job.id))).toMatchObject({ state: 'succeeded', attempts: 3, result: 'done' });
    const failed = ofType('job.failed');
    expect(failed.map((e) => e.willRetry)).toEqual([true, true]);
    expect(failed[1]!.retryAt! - failed[0]!.retryAt!).toBeGreaterThanOrEqual(20); // 20 ms, then 40 ms
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(35);
  });

  it('fails for good on a non-retryable error, or when attempts run out', async () => {
    const { engine, ofType } = testEngine();
    engine.register(
      defineJob({
        kind: 'test.fail',
        resourceClass: 'cpu',
        maxAttempts: 2,
        handler: async (payload: { fatal: boolean }) => {
          if (payload.fatal) throw Fatal();
          throw new Error('disk hiccup');
        },
      }),
    );
    await engine.start();
    const fatal = unwrap(await engine.enqueue('test.fail', { fatal: true })).job;
    const flaky = unwrap(await engine.enqueue('test.fail', { fatal: false })).job;
    expect(unwrap(await engine.wait(fatal.id))).toMatchObject({ state: 'failed', attempts: 1 });
    expect(unwrap(await engine.wait(flaky.id))).toMatchObject({
      state: 'failed',
      attempts: 2,
      error: { code: 'jobs.handler_failed' },
    });
    // The last attempt's job.failed follows its store write: wait for the run itself to end.
    await engine.whenIdle();
    expect(
      ofType('job.failed')
        .filter((e) => e.job.id === flaky.id)
        .map((e) => e.willRetry),
    ).toEqual([true, false]);
  });

  it('times out an attempt, aborting its signal, and retries it', async () => {
    const { engine } = testEngine();
    let attempts = 0;
    engine.register(
      defineJob({
        kind: 'test.slow',
        resourceClass: 'cpu',
        timeoutMs: 40,
        maxAttempts: 2,
        handler: async (_: object, signal) => {
          attempts++;
          if (attempts === 1) await sleep(5000, signal);
          return 'second time lucky';
        },
      }),
    );
    await engine.start();
    const { job } = unwrap(await engine.enqueue('test.slow', {}));
    expect(unwrap(await engine.wait(job.id))).toMatchObject({ state: 'succeeded', attempts: 2 });
    expect(TimeoutError.code).toBe('core.timeout');
  });

  it('throttles progress events but always delivers the last value, and saves it on heartbeats', async () => {
    const { engine, store, ofType } = testEngine({ progressIntervalMs: 50, heartbeatMs: 20 });
    engine.register(
      defineJob({
        kind: 'test.progress',
        resourceClass: 'io',
        handler: async (_: object, _signal, progress) => {
          for (let i = 1; i <= 100; i++) progress.report(i / 100, { done: i, total: 100 });
          await sleep(60);
          return null;
        },
      }),
    );
    await engine.start();
    const { job } = unwrap(await engine.enqueue('test.progress', {}));
    await engine.whenIdle();
    const progress = ofType('job.progress');
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress.length).toBeLessThanOrEqual(3);
    expect(progress.at(-1)).toMatchObject({ jobId: job.id, fraction: 1, detail: { done: 100, total: 100 } });
    expect(unwrap(store.get(job.id)).progress).toBe(1);
  });

  it('hands a resumed attempt the progress saved by the interrupted one', async () => {
    const { engine, store } = testEngine();
    const seen: unknown[] = [];
    engine.register(
      defineJob({
        kind: 'test.resume',
        resourceClass: 'io',
        handler: async (_: object, _signal, _progress, context) => void seen.push(context.resumeFrom),
      }),
    );
    const { job } = unwrap(await engine.enqueue('test.resume', {}));
    // An earlier worker got halfway, saved progress, then died.
    unwrap(store.claimNext({ owner: 'dead-worker', leaseMs: 0 }));
    unwrap(
      store.heartbeat(job.id, 'dead-worker', { leaseMs: 0, progress: 0.5, progressDetail: { step: 7 } }),
    );
    await engine.start();
    await engine.whenIdle();
    expect(seen).toEqual([{ fraction: 0.5, detail: { step: 7 } }]);
    expect(unwrap(store.get(job.id))).toMatchObject({ state: 'succeeded', attempts: 2 });
  });

  it('enqueues a definition this process does not run, and rejects a bad stored payload', async () => {
    const { engine, store } = testEngine();
    const render = defineJob({ kind: 'render.export', resourceClass: 'gpu', handler: async () => null });
    expect(unwrap(await engine.enqueue(render, {})).job.resourceClass).toBe('gpu');
    engine.register(probe);
    const bad = unwrap(
      store.enqueue({ kind: 'media.probe', payload: { path: 42 }, resourceClass: 'io' }),
    ).job;
    await engine.start();
    await engine.whenIdle();
    expect(unwrap(store.get(bad.id))).toMatchObject({
      state: 'failed',
      attempts: 1,
      error: { code: 'core.validation' },
    });
    expect(engine.running()).toEqual([]);
  });
});
