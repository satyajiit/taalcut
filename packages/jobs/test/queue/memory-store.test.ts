// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** MemoryJobStore follows the same state machine as @taalcut/library's JobStore. */
import { NotFoundError, unwrap, ValidationError, type JobId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { backoffDelay, DEFAULT_BACKOFF, InvalidJobState, MemoryJobStore } from '../../src/index';

function setup() {
  let now = 1_000;
  const changes: number[] = [];
  const store = new MemoryJobStore({ clock: () => now, onChange: (records) => changes.push(records.length) });
  return { store, changes, advance: (ms: number) => (now += ms), now: () => now };
}

const lease = { owner: 'w', leaseMs: 100 };

describe('MemoryJobStore', () => {
  it('claims by priority then due time, filters by class and kind, and counts attempts', () => {
    const { store, advance } = setup();
    const low = unwrap(store.enqueue({ kind: 'a', payload: {}, resourceClass: 'cpu' })).job;
    const high = unwrap(store.enqueue({ kind: 'a', payload: {}, resourceClass: 'cpu', priority: 5 })).job;
    const later = unwrap(store.enqueue({ kind: 'b', payload: {}, resourceClass: 'io', runAt: 2_000 })).job;
    expect(unwrap(store.claimNext({ ...lease, kinds: ['b'] }))).toBeNull();
    expect(unwrap(store.claimNext({ ...lease, resourceClass: 'cpu' }))?.id).toBe(high.id);
    expect(unwrap(store.claimNext({ ...lease, resourceClass: 'cpu' }))).toMatchObject({
      id: low.id,
      attempts: 1,
      leaseExpiresAt: 1_100,
    });
    advance(1_000);
    expect(unwrap(store.claimNext(lease))?.id).toBe(later.id);
    expect(store.list({ states: ['running'], kind: 'a' })).toHaveLength(2);
  });

  it('enforces lease ownership and every transition', () => {
    const { store, advance, now } = setup();
    const { id } = unwrap(
      store.enqueue({ kind: 'a', payload: {}, resourceClass: 'cpu', maxAttempts: 2, idempotencyKey: 'k' }),
    ).job;
    expect(
      unwrap(store.enqueue({ kind: 'a', payload: {}, resourceClass: 'cpu', idempotencyKey: 'k' })).created,
    ).toBe(false);
    expect(store.heartbeat(id, 'w', { leaseMs: 1 }).ok).toBe(false); // not running
    unwrap(store.claimNext(lease));
    const lost = store.heartbeat(id, 'other', { leaseMs: 1 });
    expect(!lost.ok && InvalidJobState.is(lost.error)).toBe(true);
    expect(
      unwrap(store.heartbeat(id, 'w', { leaseMs: 50, progress: 0.3, progressDetail: { n: 1 } })),
    ).toMatchObject({
      progress: 0.3,
      progressDetail: { n: 1 },
      leaseExpiresAt: now() + 50,
    });
    expect(unwrap(store.fail(id, 'w', { code: 'x' }, { retryAt: now() + 10 }))).toMatchObject({
      state: 'queued',
      attempts: 1,
    });
    advance(10);
    unwrap(store.claimNext(lease));
    expect(unwrap(store.fail(id, 'w', { code: 'x' }, { retryAt: now() }))).toMatchObject({
      state: 'failed',
      attempts: 2,
    });
    expect(store.cancel(id).ok).toBe(false);
    expect(store.complete(id, 'w').ok).toBe(false);
  });

  it('pauses, resumes, releases, cancels and recovers expired leases', () => {
    const { store, advance } = setup();
    const a = unwrap(store.enqueue({ kind: 'a', payload: {}, resourceClass: 'cpu' })).job.id;
    expect(unwrap(store.pause(a)).state).toBe('paused');
    expect(store.pause(a).ok).toBe(false);
    expect(unwrap(store.resume(a)).state).toBe('queued');
    unwrap(store.claimNext(lease));
    expect(unwrap(store.pause(a))).toMatchObject({ state: 'paused', attempts: 0, leaseOwner: null });
    unwrap(store.resume(a));
    unwrap(store.claimNext(lease));
    expect(unwrap(store.release(a, 'w'))).toMatchObject({ state: 'queued', attempts: 0 });
    const b = unwrap(store.enqueue({ kind: 'b', payload: {}, resourceClass: 'io', maxAttempts: 1 })).job.id;
    unwrap(store.claimNext({ ...lease, kinds: ['a'] }));
    unwrap(store.claimNext({ ...lease, kinds: ['b'] }));
    advance(100);
    const recovered = unwrap(store.recoverExpiredLeases());
    expect(recovered.map((j) => [j.id, j.state])).toEqual([
      [a, 'queued'],
      [b, 'failed'],
    ]);
    expect(unwrap(store.cancel(a)).state).toBe('cancelled');
    expect(unwrap(store.complete === undefined ? store.get(a) : store.get(a)).finishedAt).not.toBeNull();
  });

  it('lets a failed or cancelled job’s idempotency key start a new job, as library does', () => {
    const { store } = setup();
    const input = {
      kind: 'a',
      payload: {},
      resourceClass: 'cpu' as const,
      maxAttempts: 1,
      idempotencyKey: 'k',
    };
    const first = unwrap(store.enqueue(input)).job;
    unwrap(store.claimNext(lease));
    unwrap(store.fail(first.id, 'w', { code: 'x' }));
    const second = unwrap(store.enqueue(input));
    expect(second.created).toBe(true);
    unwrap(store.cancel(second.job.id));
    const third = unwrap(store.enqueue(input));
    expect(third.created).toBe(true);
    // A live job (here queued) still holds the key.
    expect(unwrap(store.enqueue(input))).toEqual({ job: third.job, created: false });
    unwrap(store.claimNext(lease));
    unwrap(store.complete(third.job.id, 'w'));
    expect(unwrap(store.enqueue(input))).toMatchObject({ job: { id: third.job.id }, created: false });
  });

  it('validates input, reports unknown ids and replays from a snapshot', () => {
    const { store, changes } = setup();
    expect(store.enqueue({ kind: '', payload: {}, resourceClass: 'cpu' }).ok).toBe(false);
    const nullPayload = store.enqueue({ kind: 'a', payload: null, resourceClass: 'cpu' });
    expect(!nullPayload.ok && ValidationError.is(nullPayload.error)).toBe(true);
    const missing = store.get('nope' as JobId);
    expect(!missing.ok && NotFoundError.is(missing.error)).toBe(true);
    expect(store.resume('nope' as JobId).ok).toBe(false);
    unwrap(store.enqueue({ kind: 'a', payload: { x: 1 }, resourceClass: 'cpu' }));
    expect(changes).toEqual([1]);
    const copy = new MemoryJobStore({ initial: JSON.parse(JSON.stringify(store.snapshot())) });
    expect(copy.list()).toEqual(store.list());
  });

  it('computes exponential backoff with bounded jitter', () => {
    const policy = { baseMs: 100, factor: 2, maxMs: 1_000, jitter: 0.5 };
    expect([1, 2, 3, 4, 5].map((n) => backoffDelay(n, { ...policy, jitter: 0 }))).toEqual([
      100, 200, 400, 800, 1000,
    ]);
    expect(backoffDelay(2, policy, () => 0)).toBe(100);
    expect(backoffDelay(2, policy, () => 1)).toBe(300);
    expect(backoffDelay(1, DEFAULT_BACKOFF, () => 0.5)).toBe(2000);
  });
});
