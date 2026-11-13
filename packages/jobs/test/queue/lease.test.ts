// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Leases and heartbeats: a worker that dies or stalls loses its job, which then runs again. */
import { err, unwrap, type Result } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { defineJob, MemoryJobStore, type JobRecord, type JobStore } from '../../src/index';
import { sleep, testEngine, waitFor } from './helpers';

describe('job engine: leases', () => {
  it('reclaims a job whose worker died after claiming it', async () => {
    const store = new MemoryJobStore();
    const { id } = unwrap(store.enqueue({ kind: 'test.lease', payload: {}, resourceClass: 'cpu' })).job;
    unwrap(store.claimNext({ owner: 'dead-process', leaseMs: 60 })); // claimed, then the process died
    const { engine, ofType } = testEngine({ store, bootId: 'B', leaseMs: 60, heartbeatMs: 20 });
    engine.register(defineJob({ kind: 'test.lease', resourceClass: 'cpu', handler: async () => 'rescued' }));
    await engine.start();
    expect(unwrap(store.get(id)).state).toBe('running'); // the lease hasn't expired yet
    await waitFor(() => unwrap(store.get(id)).state === 'succeeded', 3000, 'recovery');
    expect(unwrap(store.get(id))).toMatchObject({ result: 'rescued', attempts: 2, leaseOwner: null });
    expect(ofType('job.recovered').map((e) => e.job.id)).toEqual([id]);
  });

  it('aborts its own stalled run when its lease is reclaimed, and runs the job again', async () => {
    const reasons: unknown[] = [];
    let attempt = 0;
    // Heartbeats far apart: the lease lapses while the first attempt is still running.
    const { engine, store } = testEngine({ leaseMs: 50, heartbeatMs: 10_000 });
    engine.register(
      defineJob({
        kind: 'test.stall',
        resourceClass: 'cpu',
        handler: async (_: object, signal) => {
          attempt++;
          if (attempt === 1) await sleep(5000, signal).catch((e: unknown) => reasons.push(e));
          return `attempt ${attempt}`;
        },
      }),
    );
    await engine.start();
    const { id } = unwrap(await engine.enqueue('test.stall', {})).job;
    await waitFor(() => unwrap(store.get(id)).state === 'succeeded', 3000, 'second attempt');
    expect(unwrap(store.get(id))).toMatchObject({ result: 'attempt 2', attempts: 2 });
    expect(reasons).toMatchObject([{ code: 'core.cancelled', detail: 'lease_lost' }]);
  });

  it("aborts a handler whose heartbeat finds the job gone, and doesn't overwrite the new owner", async () => {
    const store = new MemoryJobStore();
    const { engine, ofType } = testEngine({ store, bootId: 'A', heartbeatMs: 15, leaseMs: 5000 });
    let reason: unknown;
    engine.register(
      defineJob({
        kind: 'test.stolen',
        resourceClass: 'io',
        handler: async (_: object, signal) => {
          await sleep(5000, signal).catch((e: unknown) => (reason = e));
          return 'too late';
        },
      }),
    );
    await engine.start();
    const { id } = unwrap(await engine.enqueue('test.stolen', {})).job;
    await waitFor(() => engine.running().length === 1);
    // Another process reclaimed the job (e.g. after a clock jump made the lease look expired).
    const stolen: JobRecord = { ...unwrap(store.get(id)), leaseOwner: 'B' };
    (store as unknown as { jobs: Map<string, JobRecord> }).jobs.set(id, stolen);
    await waitFor(() => engine.running().length === 0, 2000, 'abort on lost lease');
    expect(reason).toMatchObject({ code: 'core.cancelled', detail: 'lease_lost' });
    expect(ofType('job.lease_lost').map((e) => e.jobId)).toEqual([id]);
    expect(unwrap(store.get(id))).toMatchObject({ state: 'running', leaseOwner: 'B' });
  });

  it('retries a busy store and reports one that throws, without stopping', async () => {
    const inner = new MemoryJobStore();
    let busy = 2;
    const flaky: JobStore = Object.assign(Object.create(inner) as JobStore, {
      claimNext: (claim: Parameters<JobStore['claimNext']>[0]) => {
        if (busy-- > 0) return err({ code: 'library.database_busy', messageKey: 'x', retryable: true });
        return inner.claimNext(claim);
      },
      recoverExpiredLeases: (): Result<JobRecord[]> => {
        throw new Error('store bug');
      },
    });
    const { engine, ofType } = testEngine({ store: flaky as MemoryJobStore });
    engine.register(defineJob({ kind: 'test.busy', resourceClass: 'io', handler: async () => 'ok' }));
    await engine.start();
    const { id } = unwrap(await engine.enqueue('test.busy', {})).job;
    await engine.whenIdle();
    expect(unwrap(inner.get(id)).state).toBe('succeeded');
    expect(ofType('queue.store_error')[0]?.error.detail).toBe('Error');
  });
});
