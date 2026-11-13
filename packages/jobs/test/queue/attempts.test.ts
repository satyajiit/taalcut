// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Review 2 findings on attempts: a timeout always settles as core.timeout,
 * one job never has two live attempts in a process, and a thrown error's
 * message stays out of job.failed.
 */
import { unwrap, type JobId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { defineJob, MemoryJobStore, TERMINAL_STATES, type JobStore } from '../../src/index';
import { testEngine, waitFor } from './helpers';

const PATIENCE = 30_000;

/** Resolves after `ms` whatever happens to the signal: a handler that ignores its abort. */
const stubborn = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Counts live handler invocations. */
function liveCounter() {
  let live = 0;
  const state = { starts: 0, maxLive: 0 };
  return {
    state,
    async during<T>(work: () => Promise<T>): Promise<T> {
      state.starts++;
      state.maxLive = Math.max(state.maxLive, ++live);
      try {
        return await work();
      } finally {
        live--;
      }
    },
  };
}

const terminal = (store: MemoryJobStore, id: JobId) => {
  const job = store.get(id);
  return job.ok && TERMINAL_STATES.includes(job.value.state);
};

describe('timeouts', () => {
  it(
    'a handler that returns ok after its timeout still fails the attempt with core.timeout',
    async () => {
      const { engine, store, ofType } = testEngine({ leaseMs: 10_000 });
      engine.register(
        defineJob({
          kind: 'test.lateSuccess',
          resourceClass: 'cpu',
          timeoutMs: 40,
          maxAttempts: 1,
          handler: async () => {
            await stubborn(120);
            return 'finished-after-timeout';
          },
        }),
      );
      await engine.start();
      const { job } = unwrap(await engine.enqueue('test.lateSuccess', {}));
      await waitFor(() => terminal(store, job.id), PATIENCE, 'the job to end');
      expect(unwrap(store.get(job.id))).toMatchObject({
        state: 'failed',
        result: null,
        error: { code: 'core.timeout' },
      });
      expect(ofType('job.failed')).toMatchObject([{ error: { code: 'core.timeout' }, willRetry: false }]);
      expect(ofType('job.succeeded')).toEqual([]);
    },
    PATIENCE,
  );
});

describe('one live attempt per job', () => {
  it(
    'keeps the lease while a timed-out handler runs on, so the job is not started again beside it',
    async () => {
      const live = liveCounter();
      const { engine, store } = testEngine({
        leaseMs: 150,
        heartbeatMs: 40,
        pollMs: 20,
        concurrency: { cpu: 2 },
        backoff: { baseMs: 0, jitter: 0 },
      });
      engine.register(
        defineJob({
          kind: 'test.overrun',
          resourceClass: 'cpu',
          timeoutMs: 40,
          maxAttempts: 3,
          handler: () => live.during(() => stubborn(700)),
        }),
      );
      await engine.start();
      const { job } = unwrap(await engine.enqueue('test.overrun', {}));
      await waitFor(() => terminal(store, job.id), PATIENCE, 'the job to end');
      await engine.whenIdle();
      expect(live.state.maxLive).toBe(1);
      expect(unwrap(store.get(job.id))).toMatchObject({ state: 'failed', attempts: 3 });
    },
    PATIENCE,
  );

  it(
    'when the lease is lost anyway (no heartbeat got through), the next attempt waits for the running handler',
    async () => {
      const live = liveCounter();
      // A store whose heartbeats never renew: what a starved process looks like from outside.
      const inner = new MemoryJobStore();
      const stalled: JobStore = {
        enqueue: (input) => inner.enqueue(input),
        get: (id) => inner.get(id),
        claimNext: (claim) => inner.claimNext(claim),
        heartbeat: (id) => inner.get(id),
        complete: (id, owner, result) => inner.complete(id, owner, result),
        fail: (id, owner, error, options) => inner.fail(id, owner, error, options),
        release: (id, owner) => inner.release(id, owner),
        pause: (id) => inner.pause(id),
        resume: (id) => inner.resume(id),
        cancel: (id) => inner.cancel(id),
        recoverExpiredLeases: () => inner.recoverExpiredLeases(),
        list: (options) => inner.list(options),
      };
      const { engine } = testEngine({ store: stalled, leaseMs: 100, heartbeatMs: 20, pollMs: 20 });
      engine.register(
        defineJob({
          kind: 'test.stalled',
          resourceClass: 'cpu',
          maxAttempts: 3,
          handler: () => live.during(() => stubborn(300)),
        }),
      );
      await engine.start();
      const { job } = unwrap(await engine.enqueue('test.stalled', {}));
      await waitFor(() => live.state.starts >= 2, PATIENCE, 'a second attempt');
      await waitFor(() => terminal(inner, job.id), PATIENCE, 'the job to end');
      await engine.whenIdle();
      expect(live.state.maxLive).toBe(1);
    },
    PATIENCE,
  );
});

describe('failure detail', () => {
  it(
    "keeps a thrown error's message (it can hold a secret) out of job.failed and the stored job",
    async () => {
      const { engine, store, ofType } = testEngine();
      engine.register(
        defineJob({
          kind: 'test.leaky',
          resourceClass: 'cpu',
          maxAttempts: 1,
          handler: async () => {
            throw new Error('request failed for bearer sk-live-SECRETVALUE1234567890');
          },
        }),
      );
      await engine.start();
      const { job } = unwrap(await engine.enqueue('test.leaky', {}));
      await waitFor(() => terminal(store, job.id), PATIENCE, 'the job to end');
      const [failed] = ofType('job.failed');
      expect(failed?.error).toMatchObject({ code: 'jobs.handler_failed', detail: 'threw Error' });
      expect(JSON.stringify(ofType('job.failed'))).not.toContain('sk-live');
      expect(JSON.stringify(unwrap(store.get(job.id)))).not.toContain('sk-live');
    },
    PATIENCE,
  );
});
