// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ok, type AsyncResult, type ProductOccurrence, type ProductStore } from '@taalcut/core';
import { nextScheduleOccurrence } from './recurrence';

export interface ProductSchedulerDeps {
  readonly store: Pick<
    ProductStore,
    'listDue' | 'getSchedule' | 'expiredOccurrences' | 'claimOccurrence' | 'settleOccurrence'
  >;
  /** Enqueue or resume existing jobs using occurrence.id as the idempotency key. Never publish from here. */
  readonly execute: (occurrence: ProductOccurrence, signal: AbortSignal) => AsyncResult<void>;
  readonly now?: () => number;
  readonly concurrency?: number;
  readonly batchSize?: number;
  readonly leaseMs?: number;
}

/** One bounded pass, oldest due first, with at most one active occurrence per product. */
export function createProductScheduler(deps: ProductSchedulerDeps) {
  const now = deps.now ?? Date.now;
  const concurrency = Math.max(1, Math.min(4, Math.floor(deps.concurrency ?? 2)));
  const batchSize = Math.max(1, Math.min(100, Math.floor(deps.batchSize ?? 16)));
  const leaseMs = Math.max(60_000, deps.leaseMs ?? 30 * 60_000);
  let active: Promise<Awaited<AsyncResult<number>>> | undefined;

  async function pass(signal: AbortSignal): AsyncResult<number> {
    const at = now();
    const [due, expired] = await Promise.all([
      deps.store.listDue(at, batchSize),
      deps.store.expiredOccurrences(at, batchSize),
    ]);
    if (!due.ok) return due;
    if (!expired.ok) return expired;
    const schedules = new Map(due.value.map((schedule) => [schedule.productId, schedule]));
    for (const occurrence of expired.value) {
      if (schedules.has(occurrence.productId)) continue;
      const schedule = await deps.store.getSchedule(occurrence.productId);
      if (!schedule.ok) return schedule;
      if (schedule.value) schedules.set(occurrence.productId, schedule.value);
    }
    const pending = [
      ...expired.value.map((occurrence) => ({
        schedule: schedules.get(occurrence.productId),
        at: occurrence.scheduledFor,
      })),
      ...due.value.map((schedule) => ({ schedule, at: schedule.nextRunAt! })),
    ].sort((left, right) => left.at - right.at);
    const seen = new Set<string>();
    const batch = pending
      .filter(({ schedule }) => {
        if (!schedule?.enabled || seen.has(schedule.productId)) return false;
        seen.add(schedule.productId);
        return true;
      })
      .slice(0, batchSize);
    let cursor = 0;
    let completed = 0;
    const errors: Awaited<AsyncResult<void>>[] = [];
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (!signal.aborted) {
          const item = batch[cursor++];
          if (!item?.schedule) return;
          const next = nextScheduleOccurrence(item.schedule, at);
          if (!next.ok) {
            errors.push(next);
            continue;
          }
          const claimed = await deps.store.claimOccurrence({
            productId: item.schedule.productId,
            scheduledFor: item.at,
            now: at,
            leaseUntil: at + leaseMs,
            nextRunAt: next.value,
          });
          if (!claimed.ok) {
            errors.push(claimed);
            continue;
          }
          if (!claimed.value) continue;
          const result = await deps.execute(claimed.value, signal);
          // A shutdown leaves the lease resumable; it is not a permanent campaign failure.
          if (signal.aborted) return;
          const settled = await deps.store.settleOccurrence(
            claimed.value.id,
            result.ok ? { state: 'completed' } : { state: 'failed', detail: result.error.code },
          );
          if (!settled.ok) errors.push(settled);
          else completed++;
        }
      }),
    );
    const failure = errors.find((result) => !result.ok);
    return failure && !failure.ok ? failure : ok(completed);
  }

  return {
    /** Repeated native wakes share one pass, including while a worker is waiting on an existing job. */
    wake(signal: AbortSignal = new AbortController().signal): AsyncResult<number> {
      if (!active)
        active = pass(signal).finally(() => {
          active = undefined;
        });
      return active;
    },
  };
}
