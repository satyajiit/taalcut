// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's job contract on the engine: fromJobKind, wait, and the engine-backed
 * JobRunner, with handlers that run a (fake) ffprobe process. Every wait is
 * on observable state (a pid file, a job's state), never on elapsed time.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineJobKind, newId, ok, unwrap, type JobProgress } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createEngineJobRunner,
  defineJob,
  fromJobKind,
  isValidJobKind,
  PRIORITY_VALUES,
  type JobEvent,
} from '../../src/index';
import {
  brokenProbeHandler,
  brokenProbeKind,
  fakeIsRunning,
  frameKind,
  probeHandler,
  probeKind,
  READING_STAGE,
  release,
  writeFakeFfprobe,
  type FakeFfprobe,
} from '../fixtures/probe-job';
import { LONG_LEASE_MS } from '../fixtures/step-job';
import { deferred, testEngine, waitFor } from './helpers';

let dir: string;
let fake: FakeFfprobe;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'taalcut-core-kinds-'));
  fake = writeFakeFfprobe(dir);
});
afterEach(() => {
  release(fake); // ends any fake ffprobe still waiting
  rmSync(dir, { recursive: true, force: true });
});

/** Patience for a busy machine; the tests wait on state, so a fast machine never waits this long. */
const PATIENCE = 30_000;
/** Each test spawns processes, which a machine running every package's tests at once can make take seconds. */
const SLOW = { timeout: 90_000 };

/**
 * An engine whose leases outlive any test: lease expiry isn't under test
 * here, and a starved event loop must not look like a dead worker.
 */
const steadyEngine = (options: Parameters<typeof testEngine>[0] = {}) =>
  testEngine({ leaseMs: LONG_LEASE_MS, ...options });

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('kind names', () => {
  it("accepts core's camelCase kinds and the engine's lower-case ones, nothing looser", () => {
    for (const kind of [
      'media.extractFrame',
      'media.probe',
      'vision.embedShots',
      'components.install',
      'test.steps',
    ])
      expect(isValidJobKind(kind), kind).toBe(true);
    for (const kind of [
      'Media.probe',
      'media.Probe',
      'media..probe',
      'media probe',
      'media.',
      '.media',
      'média.x',
      '',
    ])
      expect(isValidJobKind(kind), kind).toBe(false);
  });
});

describe('fromJobKind', SLOW, () => {
  it("maps core's kind onto an engine definition", () => {
    const definition = fromJobKind(probeKind, probeHandler(fake));
    expect(definition).toMatchObject({
      kind: 'test.probeMedia',
      resourceClass: 'io',
      priority: PRIORITY_VALUES.high,
      maxAttempts: 2,
      retryPolicy: probeKind.retry,
      timeoutMs: 60_000,
    });
    expect(definition.idempotencyKey?.({ path: '/a.mov' })).toBe('test.probeMedia:/a.mov');
    expect(fromJobKind(frameKind, async () => ok({ n: 1 }))).toMatchObject({
      resourceClass: 'gpu',
      maxAttempts: 3, // core's DEFAULT_RETRY
    });
  });

  it('derives the idempotency key when enqueue gets none, so one input is one job', async () => {
    const { engine } = steadyEngine();
    const definition = fromJobKind(probeKind, probeHandler(fake));
    const first = unwrap(await engine.enqueue(definition, { path: '/a.mov' }));
    const again = unwrap(await engine.enqueue(definition, { path: '/a.mov' }));
    expect(first).toMatchObject({ created: true, job: { idempotencyKey: 'test.probeMedia:/a.mov' } });
    expect(again).toMatchObject({ created: false, job: { id: first.job.id } });
  });

  it('a result that fails the output schema fails the job with jobs.output_invalid, without a retry', async () => {
    const { engine, store } = steadyEngine();
    engine.register(fromJobKind(brokenProbeKind, brokenProbeHandler()));
    await engine.start();
    const result = await createEngineJobRunner(engine).run(brokenProbeKind, { path: '/a.mov' });
    expect(!result.ok && result.error).toMatchObject({
      code: 'jobs.output_invalid',
      params: { kind: 'test.brokenProbe' },
    });
    expect(store.snapshot()).toMatchObject([{ state: 'failed', attempts: 1, maxAttempts: 2 }]);
  });
});

describe('createEngineJobRunner', SLOW, () => {
  async function started() {
    const env = steadyEngine();
    env.engine.register(fromJobKind(probeKind, probeHandler(fake)));
    env.engine.register(fromJobKind(frameKind, async (input) => ok({ n: input.n })));
    await env.engine.start();
    return { ...env, jobs: createEngineJobRunner(env.engine) };
  }

  it('runs the job and returns its validated output, with core JobProgress', async () => {
    const { jobs, store } = await started();
    release(fake);
    const progress: JobProgress[] = [];
    const enqueued: string[] = [];
    const result = await jobs.run(
      probeKind,
      { path: '/clip.mov' },
      { onProgress: (p) => progress.push(p), onEnqueued: (jobId) => enqueued.push(jobId) },
    );
    expect(result).toEqual(ok({ path: '/clip.mov', durationSeconds: 2.002 }));
    expect(progress[0]).toEqual({ fraction: 0, stageKey: READING_STAGE });
    expect(progress.at(-1)).toEqual({ fraction: 1 });
    expect(store.snapshot()).toMatchObject([
      { state: 'succeeded', attempts: 1, priority: PRIORITY_VALUES.high },
    ]);
    expect(enqueued).toEqual([store.snapshot()[0]!.id]);
  });

  it('retries a retryable failure with the kind’s policy, then succeeds', async () => {
    const { jobs, ofType } = await started();
    release(fake);
    writeFileSync(fake.failOnce, '');
    const result = await jobs.run(probeKind, { path: '/clip.mov' });
    expect(result.ok).toBe(true);
    expect(ofType('job.failed')).toMatchObject([{ willRetry: true, error: { code: 'core.timeout' } }]);
    expect(ofType('job.succeeded')).toMatchObject([{ job: { attempts: 2 } }]);
  });

  it('aborting the signal cancels the job and stops the ffprobe it is running', async () => {
    const { jobs, store } = await started();
    const controller = new AbortController();
    const running = jobs.run(probeKind, { path: '/slow.mov' }, { signal: controller.signal });
    await waitFor(() => fakeIsRunning(fake), PATIENCE, 'the fake ffprobe to start');
    const pid = Number(readFileSync(fake.pidfile, 'utf8'));
    controller.abort();
    const result = await running;
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    expect(store.snapshot()).toMatchObject([{ state: 'cancelled' }]);
    await waitFor(() => !alive(pid), PATIENCE, 'the fake ffprobe to stop');
  });

  it('two callers with the same input share one job; one giving up does not cancel it for the other', async () => {
    const { jobs, store } = await started();
    const quitter = new AbortController();
    const stays = jobs.run(probeKind, { path: '/shared.mov' });
    const leaves = jobs.run(probeKind, { path: '/shared.mov' }, { signal: quitter.signal });
    await waitFor(() => fakeIsRunning(fake), PATIENCE, 'the fake ffprobe to start');
    quitter.abort();
    expect(await leaves).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    release(fake);
    expect(await stays).toEqual(ok({ path: '/shared.mov', durationSeconds: 2.002 }));
    expect(store.snapshot()).toMatchObject([{ state: 'succeeded' }]);
  });

  it('waits for a job another engine runs (shared store), by polling it', async () => {
    const worker = steadyEngine();
    worker.engine.register(fromJobKind(probeKind, probeHandler(fake)));
    // The caller's engine has no handler for the kind: it only enqueues and waits.
    const caller = steadyEngine({ store: worker.store });
    await caller.engine.start();
    release(fake);
    const result = createEngineJobRunner(caller.engine).run(probeKind, { path: '/remote.mov' });
    await worker.engine.start();
    expect(await result).toEqual(ok({ path: '/remote.mov', durationSeconds: 2.002 }));
  });

  it('wait returns a job that has already finished, and core.not_found for an unknown id', async () => {
    const { engine, jobs, store } = await started();
    release(fake);
    unwrap(await jobs.run(probeKind, { path: '/done.mov' }));
    const [done] = store.snapshot();
    expect(await engine.wait(done!.id)).toMatchObject({ ok: true, value: { state: 'succeeded' } });
    expect(await engine.wait(newId<'Job'>())).toMatchObject({ ok: false, error: { code: 'core.not_found' } });
  });
});

describe('GPU compute class', SLOW, () => {
  it('runs gpu jobs one at a time by default while io jobs run beside them, and the events show it', async () => {
    const gates = new Map<number, ReturnType<typeof deferred<void>>>();
    const { engine, events } = steadyEngine();
    const slowFrames = defineJobKind({ ...frameKind, kind: 'test.slowFrame' });
    engine.register(
      fromJobKind(slowFrames, async (input) => {
        const gate = deferred();
        gates.set(input.n, gate);
        await gate.promise;
        return ok({ n: input.n });
      }),
    );
    engine.register(fromJobKind(probeKind, probeHandler(fake)));
    await engine.start();
    const jobs = createEngineJobRunner(engine);
    const frames = [1, 2, 3].map((n) => jobs.run(slowFrames, { path: '/clip.mov', n }));
    await waitFor(() => gates.size === 1, PATIENCE, 'the first frame job');
    // While a gpu job runs, an io job (a probe) still starts and finishes.
    release(fake);
    expect((await jobs.run(probeKind, { path: '/beside.mov' })).ok).toBe(true);
    expect(gates.size).toBe(1);
    for (const n of [1, 2, 3]) {
      await waitFor(() => gates.has(n), PATIENCE, `frame job ${n}`);
      expect(engine.running().filter((job) => job.resourceClass === 'gpu')).toHaveLength(1);
      gates.get(n)!.resolve();
    }
    expect((await Promise.all(frames)).map((r) => r.ok && r.value.n)).toEqual([1, 2, 3]);

    // The event log: a gpu job starts only after the previous one has finished.
    const gpu = (e: JobEvent) => 'job' in e && e.job.resourceClass === 'gpu';
    const sequence = events.filter((e) => gpu(e) && (e.type === 'job.started' || e.type === 'job.succeeded'));
    expect(sequence.map((e) => e.type)).toEqual([
      'job.started',
      'job.succeeded',
      'job.started',
      'job.succeeded',
      'job.started',
      'job.succeeded',
    ]);
    expect(engine.limits().gpu).toBe(1);
  });
});

describe('per-kind retry delay', SLOW, () => {
  it(
    "a definition's own backoff applies (the engine's default would wait a minute)",
    async () => {
      let calls = 0;
      const { engine } = steadyEngine({ backoff: { baseMs: 60_000, factor: 1, jitter: 0 } });
      engine.register(
        defineJob({
          kind: 'test.quickRetry',
          resourceClass: 'cpu',
          backoff: { baseMs: 1, jitter: 0 },
          handler: async () => {
            if (++calls === 1) throw new Error('transient');
            return 'done';
          },
        }),
      );
      await engine.start();
      const { job } = unwrap(await engine.enqueue('test.quickRetry', {}));
      expect(await engine.wait(job.id)).toMatchObject({
        ok: true,
        value: { state: 'succeeded', attempts: 2 },
      });
    },
    PATIENCE,
  );
});

describe('output validation of stored results', SLOW, () => {
  it('the runner checks a stored result against the kind it asked for', async () => {
    const { engine, store } = steadyEngine();
    // A worker built with a different (older) output schema stored a result this kind rejects.
    const older = defineJobKind({
      ...probeKind,
      output: z.object({ path: z.string(), durationSeconds: z.number() }),
    });
    engine.register(fromJobKind(older, async (input) => ok({ path: input.path, durationSeconds: -5 })));
    await engine.start();
    const result = await createEngineJobRunner(engine).run(probeKind, { path: '/old.mov' });
    expect(!result.ok && result.error.code).toBe('jobs.output_invalid');
    expect(store.snapshot()).toMatchObject([{ state: 'succeeded' }]);
  });
});
