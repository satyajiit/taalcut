// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An exclusive engine (the app's one jobs process) takes over the leases a
 * dead earlier instance still holds as soon as it starts, instead of waiting
 * for them to expire; the first restarts don't spend the attempt, later ones
 * do, so a crash loop ends. The count is the job row's `interruptions`.
 */
import { unwrap, type JobId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { defineJob, MemoryJobStore, type JobRecord } from '../../src/index';
import { sleep, testEngine, waitFor } from './helpers';

const LONG_LEASE_MS = 10 * 60_000;
const KIND = 'test.takeover';

/** A job claimed by a process that then died, its lease still minutes from expiring. */
function heldByDeadProcess(store: MemoryJobStore, maxAttempts = 3): JobId {
  const { id } = unwrap(store.enqueue({ kind: KIND, payload: {}, resourceClass: 'cpu', maxAttempts })).job;
  unwrap(store.claimNext({ owner: 'jobs:dead', leaseMs: LONG_LEASE_MS, kinds: [KIND] }));
  return id;
}

function job(handler: (payload: object, signal: AbortSignal) => Promise<unknown> = async () => 'done') {
  return defineJob({ kind: KIND, resourceClass: 'cpu', handler });
}

/** Runs until aborted: the process "dies" with the handler mid-job. */
const forever = (_: object, signal: AbortSignal) =>
  new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

describe('job engine: exclusive takeover at start', () => {
  it("resumes a dead instance's job at once and gives the interrupted attempt back", async () => {
    const store = new MemoryJobStore();
    const id = heldByDeadProcess(store);
    const logged: string[] = [];
    const { engine, ofType } = testEngine({
      store,
      exclusive: true,
      log: (message) => logged.push(message),
      leaseMs: LONG_LEASE_MS,
    });
    engine.register(job());
    await engine.start();
    await waitFor(() => unwrap(store.get(id)).state === 'succeeded', 2000, 'the taken-over job');

    expect(unwrap(store.get(id))).toMatchObject({
      result: 'done',
      attempts: 1,
      leaseOwner: null,
      interruptions: 1,
    });
    expect(ofType('job.recovered')).toMatchObject([
      {
        job: { id, state: 'queued', attempts: 0 },
        takeover: { previousOwner: 'jobs:dead', restarts: 1, attemptCounted: false },
      },
    ]);
    expect(logged).toEqual([
      `took over ${KIND} ${id} from jobs:dead (restart 1): requeued, attempt given back`,
    ]);
  });

  it('counts the attempt once the free restarts are used, and fails a job that was on its last', async () => {
    const before = new MemoryJobStore();
    const again = heldByDeadProcess(before, 3);
    const last = heldByDeadProcess(before, 1);
    // Both were interrupted twice already.
    const store = new MemoryJobStore({ initial: before.snapshot().map((j) => ({ ...j, interruptions: 2 })) });
    const ran: JobId[] = [];
    const { engine, ofType } = testEngine({ store, exclusive: true, log: () => undefined });
    engine.register(
      defineJob({
        kind: KIND,
        resourceClass: 'cpu',
        handler: async (_: object, _s, _p, ctx) => ran.push(ctx.jobId),
      }),
    );
    await engine.start();
    await waitFor(() => unwrap(store.get(again)).state === 'succeeded', 2000, 'the requeued job');

    expect(unwrap(store.get(again)).attempts).toBe(2);
    expect(unwrap(store.get(last))).toMatchObject({
      state: 'failed',
      attempts: 1,
      error: { code: 'core.process_restarted' },
    });
    expect(ran).toEqual([again]);
    const takeovers = Object.fromEntries(ofType('job.recovered').map((e) => [e.job.id, e.takeover]));
    expect(takeovers).toEqual({
      [again]: { previousOwner: 'jobs:dead', restarts: 3, attemptCounted: true },
      [last]: { previousOwner: 'jobs:dead', restarts: 3, attemptCounted: true },
    });
    expect(unwrap(store.get(again)).interruptions).toBe(3);
    expect(unwrap(store.get(last)).interruptions).toBe(3);
  });

  it('ends a crash loop: 2 free restarts, then 3 counted attempts, then the job fails', async () => {
    const first = new MemoryJobStore();
    const { id } = unwrap(
      first.enqueue({ kind: KIND, payload: {}, resourceClass: 'cpu', maxAttempts: 3 }),
    ).job;
    let disk: readonly JobRecord[] = first.snapshot();
    let boots = 0;
    for (; boots < 10; boots++) {
      // Each boot reads what the last one left on disk; the handler never returns, the process "dies" mid-job.
      const store = new MemoryJobStore({ initial: disk });
      if (unwrap(store.get(id)).state === 'failed' && boots > 0) break;
      const { engine } = testEngine({
        store,
        exclusive: true,
        log: () => undefined,
        leaseMs: LONG_LEASE_MS,
      });
      engine.register(job(forever));
      await engine.start();
      const settled = () => {
        const record = unwrap(store.get(id));
        return record.state === 'failed' || record.leaseOwner === engine.bootId;
      };
      await waitFor(settled, 2000, `boot ${boots + 1}`);
      disk = store.snapshot();
    }
    // Boot 1 claims it; boots 2-3 restart it for free; boots 4-6 spend attempts 2, 3 and then fail it.
    expect(boots).toBe(6);
    expect(unwrap(new MemoryJobStore({ initial: disk }).get(id))).toMatchObject({
      state: 'failed',
      attempts: 3,
      error: { code: 'core.process_restarted' },
      interruptions: 5,
    });
  });

  it('reads a snapshot from before the count existed as never interrupted', async () => {
    const old = new MemoryJobStore();
    const id = heldByDeadProcess(old);
    const legacy = old.snapshot().map(({ interruptions: _, ...rest }) => rest);
    const store = new MemoryJobStore({ initial: legacy });
    const { engine, ofType } = testEngine({ store, exclusive: true, log: () => undefined });
    engine.register(job());
    await engine.start();
    await waitFor(() => unwrap(store.get(id)).state === 'succeeded', 2000, 'the taken-over job');
    expect(ofType('job.recovered')[0]?.takeover).toMatchObject({ restarts: 1, attemptCounted: false });
  });

  it('leaves a live lease alone when the engine is not exclusive', async () => {
    const store = new MemoryJobStore();
    const id = heldByDeadProcess(store);
    const { engine, ofType } = testEngine({ store });
    engine.register(job());
    await engine.start();
    await sleep(100);
    expect(unwrap(store.get(id))).toMatchObject({ state: 'running', leaseOwner: 'jobs:dead' });
    expect(ofType('job.recovered')).toEqual([]);
  });

  it('gives each engine its own boot id, the owner of its leases', async () => {
    const one = testEngine();
    const two = testEngine();
    expect(one.engine.bootId).toMatch(/^jobs:\d+:[0-9a-f-]{36}$/);
    expect(two.engine.bootId).not.toBe(one.engine.bootId);
    one.engine.register(job(() => sleep(200)));
    await one.engine.start();
    const { id } = unwrap(await one.engine.enqueue(KIND, {})).job;
    await waitFor(() => unwrap(one.store.get(id)).state === 'running', 2000, 'the claim');
    expect(unwrap(one.store.get(id)).leaseOwner).toBe(one.engine.bootId);
  });
});
