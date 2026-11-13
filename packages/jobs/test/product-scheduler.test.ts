// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, ok, type ProductOccurrence, type ProductSchedule } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { createProductScheduler, type ProductSchedulerDeps } from '../src/schedules/product-scheduler';

const now = Date.parse('2026-11-06T12:00:00Z');
const schedule = (ago: number): ProductSchedule => ({
  productId: newId<'Product'>(),
  revision: 1,
  enabled: true,
  timeZone: 'UTC',
  localTime: '09:00',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  nextRunAt: now - ago,
});
function fixture(schedules = [schedule(5000), schedule(3000), schedule(1000)]) {
  const claimed: ProductOccurrence[] = [];
  const store: ProductSchedulerDeps['store'] = {
    listDue: vi.fn(async () => ok(schedules)),
    getSchedule: vi.fn(async (id) => ok(schedules.find((item) => item.productId === id) ?? null)),
    expiredOccurrences: vi.fn(async () => ok([])),
    claimOccurrence: vi.fn(async (input) => {
      const occurrence: ProductOccurrence = {
        id: newId<'ProductOccurrence'>(),
        productId: input.productId,
        scheduledFor: input.scheduledFor,
        leaseUntil: input.leaseUntil,
        state: 'running',
        detail: null,
        createdAt: now,
        updatedAt: now,
      };
      claimed.push(occurrence);
      return ok(occurrence);
    }),
    settleOccurrence: vi.fn(async () => ok(undefined)),
  };
  return { store, schedules, claimed };
}

describe('product schedule execution', () => {
  it('bounds workers and batches, preserving oldest-due fairness and coalescing missed dates', async () => {
    const { store, schedules, claimed } = fixture();
    let running = 0;
    let peak = 0;
    const scheduler = createProductScheduler({
      store,
      now: () => now,
      concurrency: 2,
      batchSize: 2,
      execute: async () => {
        peak = Math.max(peak, ++running);
        await Promise.resolve();
        running--;
        return ok(undefined);
      },
    });
    expect(await scheduler.wake()).toEqual(ok(2));
    expect(peak).toBe(2);
    expect(store.getSchedule).not.toHaveBeenCalled();
    expect(claimed.map((item) => item.productId)).toEqual(
      schedules.slice(0, 2).map((item) => item.productId),
    );
    expect(store.claimOccurrence).toHaveBeenCalledWith(
      expect.objectContaining({
        nextRunAt: Date.parse('2026-11-07T09:00:00Z'),
      }),
    );
  });
  it('coalesces simultaneous wakes into one durable claim pass', async () => {
    const { store } = fixture([schedule(1000)]);
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async () => {
      await wait;
      return ok(undefined);
    });
    const scheduler = createProductScheduler({ store, execute, now: () => now });
    const first = scheduler.wake();
    const second = scheduler.wake();
    expect(second).toBe(first);
    release();
    await first;
    expect(store.claimOccurrence).toHaveBeenCalledTimes(1);
  });
  it('resumes an expired occurrence instead of starting a second occurrence for the same product', async () => {
    const { store, schedules } = fixture([schedule(1000)]);
    const old: ProductOccurrence = {
      id: newId<'ProductOccurrence'>(),
      productId: schedules[0]!.productId,
      scheduledFor: now - 86400000,
      leaseUntil: now - 1,
      state: 'running',
      detail: null,
      createdAt: now - 86400000,
      updatedAt: now - 1,
    };
    store.expiredOccurrences = vi.fn(async () => ok([old]));
    store.listDue = vi.fn(async () => ok([]));
    const scheduler = createProductScheduler({ store, now: () => now, execute: async () => ok(undefined) });
    await scheduler.wake();
    expect(store.getSchedule).toHaveBeenCalledExactlyOnceWith(old.productId);
    expect(store.claimOccurrence).toHaveBeenCalledTimes(1);
    expect(store.claimOccurrence).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledFor: old.scheduledFor }),
    );
  });
  it('does no work after losing a durable claim and leaves interrupted work resumable', async () => {
    const { store } = fixture([schedule(1000)]);
    const execute = vi.fn(async () => ok(undefined));
    store.claimOccurrence = vi.fn(async () => ok(null));
    await createProductScheduler({ store, execute, now: () => now }).wake();
    expect(execute).not.toHaveBeenCalled();
    const other = fixture([schedule(1000)]);
    const abort = new AbortController();
    await createProductScheduler({
      store: other.store,
      now: () => now,
      execute: async () => {
        abort.abort();
        return ok(undefined);
      },
    }).wake(abort.signal);
    expect(other.store.settleOccurrence).not.toHaveBeenCalled();
  });
});
