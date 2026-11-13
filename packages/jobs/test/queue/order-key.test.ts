// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-S4: depth-first claims. The order key ranks queued jobs within a priority (lower first, none last), and
 * the `afterJob` step lets the indexing pipeline enqueue what a finished job unblocked before its slot is
 * offered again, so an asset's next stage beats the next asset's work to the slot.
 */
import { describe, expect, it } from 'vitest';
import { unwrap } from '@taalcut/core';
import { defineJob, MemoryJobStore, type JobEngine } from '../../src/index';
import { steppingStore, testEngine, waitFor } from './helpers';

/** A two-stage "pipeline": each asset's stage 1 enqueues its stage 2 when the engine asks after the job. */
function twoStages() {
  const ran: string[] = [];
  const pending = new Map<string, number>();
  const stage2 = defineJob({
    kind: 'test.stage2',
    resourceClass: 'video',
    handler: async ({ asset }: { asset: number }) => void ran.push(`stage2 #${asset}`),
  });
  const stage1 = defineJob({
    kind: 'test.stage1',
    resourceClass: 'video',
    handler: async ({ asset }: { asset: number }, _signal, _progress, context) => {
      ran.push(`stage1 #${asset}`);
      pending.set(context.jobId, asset);
    },
  });
  /** What the pipeline does on a settle: feed the finished asset's next stage, with its order key. */
  const afterJob = async (engine: JobEngine, jobId: string) => {
    const asset = pending.get(jobId);
    if (asset === undefined) return;
    pending.delete(jobId);
    await new Promise((resolve) => setTimeout(resolve, 5)); // a feed takes a few ms
    await engine.enqueue(stage2, { asset }, { orderKey: asset });
  };
  return { ran, stage1, stage2, afterJob };
}

describe('job engine: order keys and the after-job step', () => {
  it('claims within a priority by order key, jobs without one last', () => {
    const store = steppingStore();
    const add = (orderKey?: number, priority = 0) =>
      unwrap(
        store.enqueue({
          kind: 'test.k',
          payload: {},
          resourceClass: 'cpu',
          priority,
          ...(orderKey !== undefined ? { orderKey } : {}),
        }),
      ).job;
    const none = add();
    const three = add(3);
    const one = add(1);
    const high = add(9, 10);
    const minus = add(-2);
    const order: unknown[] = [];
    for (;;) {
      const next = store.claimNext({ owner: 'o', leaseMs: 1000 });
      if (!next.ok || !next.value) break;
      order.push(next.value.id);
    }
    expect(order).toEqual([high, minus, one, three, none].map((job) => job.id));
    // A snapshot from before round IX has no key: it reads as a job without one.
    const { orderKey: _orderKey, ...legacy } = one;
    expect(new MemoryJobStore({ initial: [legacy] }).snapshot()).toEqual([{ ...one, orderKey: null }]);
  });

  it('runs one asset’s next stage before the next asset’s first when the after-job step feeds it', async () => {
    const stages = twoStages();
    const { engine } = testEngine({
      store: steppingStore(),
      concurrency: { video: 1 },
      afterJob: (jobId) => stages.afterJob(engine, jobId),
    });
    engine.register(stages.stage1);
    engine.register(stages.stage2);
    for (const asset of [1, 2, 3]) await engine.enqueue(stages.stage1, { asset }, { orderKey: asset });
    await engine.start();
    await waitFor(() => stages.ran.length === 6);
    expect(stages.ran).toEqual([
      'stage1 #1',
      'stage2 #1',
      'stage1 #2',
      'stage2 #2',
      'stage1 #3',
      'stage2 #3',
    ]);
  });

  it('frees the slot after afterJobMs when the step hangs, and logs a step that fails', async () => {
    const lines: string[] = [];
    const started: number[] = [];
    let calls = 0;
    const { engine } = testEngine({
      store: steppingStore(),
      concurrency: { cpu: 1 },
      afterJobMs: 40,
      log: (line) => lines.push(line),
      afterJob: () =>
        ++calls === 1 ? new Promise<void>(() => undefined) : Promise.reject(new Error('boom')),
    });
    const job = defineJob({
      kind: 'test.quick',
      resourceClass: 'cpu',
      handler: async (_payload: { n: number }) => void started.push(Date.now()),
    });
    engine.register(job);
    for (const n of [1, 2, 3]) await engine.enqueue(job, { n });
    await engine.start();
    await waitFor(() => started.length === 3);
    await engine.whenIdle();
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(35); // held by the hanging step, then freed
    expect(lines.some((line) => /after-job step for \S+ failed: Error: boom/.test(line))).toBe(true);
  });
});
