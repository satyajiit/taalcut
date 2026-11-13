// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ProcessRestartedError, unwrap, ValidationError } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRepositories, InvalidState, type JobEnqueue } from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';

function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  return { db, clock, jobs: createRepositories(db).jobs };
}

const probe = (extra: Partial<JobEnqueue> = {}): JobEnqueue => ({
  kind: 'media.probe',
  payload: { path: '/a.mov' },
  resourceClass: 'io',
  ...extra,
});

const lease = { owner: 'worker-1', leaseMs: 30_000 };

describe('JobStore', () => {
  it('enqueues once per idempotency key', () => {
    const { jobs } = setup();
    const first = unwrap(jobs.enqueue(probe({ idempotencyKey: 'probe:/a.mov' })));
    const second = unwrap(jobs.enqueue(probe({ idempotencyKey: 'probe:/a.mov', priority: 9 })));
    expect(first.created).toBe(true);
    expect(second).toEqual({ job: first.job, created: false });
    expect(jobs.findByIdempotencyKey('probe:/a.mov')?.id).toBe(first.job.id);
    expect(jobs.list()).toHaveLength(1);
  });

  it('claims by priority, then due time, per resource class', () => {
    const { jobs, clock } = setup();
    const low = unwrap(jobs.enqueue(probe({ priority: 0 }))).job;
    const high = unwrap(jobs.enqueue(probe({ priority: 5 }))).job;
    const later = unwrap(jobs.enqueue(probe({ priority: 10, runAt: clock.now() + 60_000 }))).job;
    const gpu = unwrap(jobs.enqueue(probe({ resourceClass: 'gpu', kind: 'vision.embed' }))).job;

    expect(unwrap(jobs.claimNext({ ...lease, resourceClass: 'io' }))?.id).toBe(high.id);
    expect(unwrap(jobs.claimNext({ ...lease, resourceClass: 'io' }))?.id).toBe(low.id);
    expect(unwrap(jobs.claimNext({ ...lease, resourceClass: 'io' }))).toBeNull(); // `later` isn't due
    clock.advance(60_000);
    const claimed = unwrap(jobs.claimNext({ ...lease, resourceClass: 'io' }));
    expect(claimed).toMatchObject({ id: later.id, state: 'running', attempts: 1, leaseOwner: 'worker-1' });
    expect(unwrap(jobs.claimNext({ ...lease, kinds: ['vision.embed'] }))?.id).toBe(gpu.id);
  });

  it("claims only the named jobs when asked by id (a running job's children)", () => {
    const { jobs } = setup();
    const first = unwrap(jobs.enqueue(probe({ priority: 5 }))).job;
    const child = unwrap(jobs.enqueue(probe({ priority: 0 }))).job;
    expect(unwrap(jobs.claimNext({ ...lease, ids: [child.id] }))?.id).toBe(child.id);
    expect(unwrap(jobs.claimNext({ ...lease, ids: [child.id] }))).toBeNull();
    expect(unwrap(jobs.claimNext(lease))?.id).toBe(first.id);
  });

  it('stores a video job and an npu job', () => {
    const { jobs } = setup();
    const video = unwrap(jobs.enqueue(probe({ resourceClass: 'video', kind: 'media.extractFrame' }))).job;
    const npu = unwrap(jobs.enqueue(probe({ resourceClass: 'npu', kind: 'vision.embed' }))).job;
    expect(video.resourceClass).toBe('video');
    expect(npu.resourceClass).toBe('npu');
    expect(unwrap(jobs.claimNext({ ...lease, resourceClass: 'video' }))?.id).toBe(video.id);
  });

  it('records progress on heartbeat and completes', () => {
    const { jobs, clock } = setup();
    const { id } = unwrap(jobs.enqueue(probe())).job;
    unwrap(jobs.claimNext(lease));
    clock.advance(1000);
    const beat = unwrap(
      jobs.heartbeat(id, 'worker-1', {
        leaseMs: 30_000,
        progress: 0.5,
        progressDetail: { done: 1, total: 2 },
      }),
    );
    expect(beat).toMatchObject({
      progress: 0.5,
      progressDetail: { done: 1, total: 2 },
      leaseExpiresAt: clock.now() + 30_000,
    });
    const bad = jobs.heartbeat(id, 'worker-1', { leaseMs: 1, progress: 2 });
    expect(!bad.ok && ValidationError.is(bad.error)).toBe(true);
    const done = unwrap(jobs.complete(id, 'worker-1', { duration: 3 }));
    expect(done).toMatchObject({
      state: 'succeeded',
      progress: 1,
      result: { duration: 3 },
      leaseOwner: null,
    });
    expect(!jobs.complete(id, 'worker-1').ok).toBe(true);
  });

  it('rejects calls from a worker that lost its lease', () => {
    const { jobs } = setup();
    const { id } = unwrap(jobs.enqueue(probe())).job;
    unwrap(jobs.claimNext(lease));
    const other = jobs.heartbeat(id, 'worker-2', { leaseMs: 1 });
    expect(!other.ok && InvalidState.is(other.error) && other.error.params?.state).toBe('lease_lost');
  });

  it('retries with backoff until attempts run out', () => {
    const { jobs, clock } = setup();
    const { id } = unwrap(jobs.enqueue(probe({ maxAttempts: 2 }))).job;
    unwrap(jobs.claimNext(lease));
    const retry = unwrap(
      jobs.fail(id, 'worker-1', { code: 'media.probe_failed' }, { retryAt: clock.now() + 5000 }),
    );
    expect(retry).toMatchObject({
      state: 'queued',
      attempts: 1,
      nextRunAt: clock.now() + 5000,
      error: { code: 'media.probe_failed' },
    });
    expect(unwrap(jobs.claimNext(lease))).toBeNull();
    clock.advance(5000);
    unwrap(jobs.claimNext(lease));
    const failed = unwrap(
      jobs.fail(id, 'worker-1', { code: 'media.probe_failed' }, { retryAt: clock.now() }),
    );
    expect(failed).toMatchObject({ state: 'failed', attempts: 2, finishedAt: clock.now() });
  });

  it('releases a running job back to the queue without spending the attempt', () => {
    const { jobs, clock } = setup();
    const { id } = unwrap(jobs.enqueue(probe({ runAt: clock.now() - 10 }))).job;
    unwrap(jobs.claimNext(lease));
    clock.advance(5);
    const released = unwrap(jobs.release(id, 'worker-1'));
    expect(released).toMatchObject({
      state: 'queued',
      attempts: 0,
      leaseOwner: null,
      nextRunAt: clock.now(),
    });
    expect(jobs.release(id, 'worker-1').ok).toBe(false); // not running any more
  });

  it('pauses, resumes and cancels', () => {
    const { jobs } = setup();
    const { id } = unwrap(jobs.enqueue(probe())).job;
    unwrap(jobs.claimNext(lease));
    const paused = unwrap(jobs.pause(id));
    expect(paused).toMatchObject({ state: 'paused', attempts: 0, leaseOwner: null });
    // The worker notices on its next heartbeat.
    expect(jobs.heartbeat(id, 'worker-1', { leaseMs: 1 }).ok).toBe(false);
    expect(unwrap(jobs.claimNext(lease))).toBeNull();
    expect(unwrap(jobs.resume(id)).state).toBe('queued');
    expect(!jobs.resume(id).ok).toBe(true);
    expect(unwrap(jobs.cancel(id)).state).toBe('cancelled');
    const again = jobs.cancel(id);
    expect(!again.ok && again.error.params?.state).toBe('cancelled');
  });

  it('requeues jobs whose worker died, and fails them once out of attempts', () => {
    const { jobs, clock } = setup();
    const a = unwrap(jobs.enqueue(probe())).job;
    const b = unwrap(jobs.enqueue(probe({ maxAttempts: 1 }))).job;
    unwrap(jobs.claimNext(lease));
    unwrap(jobs.claimNext(lease));
    expect(unwrap(jobs.recoverExpiredLeases())).toEqual([]); // leases still valid
    clock.advance(30_000);
    const recovered = unwrap(jobs.recoverExpiredLeases());
    const byId = Object.fromEntries(recovered.map((j) => [j.id, j]));
    expect(byId[a.id]).toMatchObject({ state: 'queued', attempts: 1, leaseOwner: null });
    expect(byId[b.id]?.state).toBe('failed');
    expect(ProcessRestartedError.is(byId[b.id]?.error)).toBe(true);
    expect(jobs.list({ states: ['queued'] }).map((j) => j.id)).toEqual([a.id]);
  });

  it('validates input', () => {
    const { jobs } = setup();
    expect(jobs.enqueue(probe({ kind: '' })).ok).toBe(false);
    expect(jobs.enqueue(probe({ payload: undefined })).ok).toBe(false);
    expect(jobs.get('missing' as never).ok).toBe(false);
  });
});
