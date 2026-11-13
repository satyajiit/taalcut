// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process glue: engine events as core events, main's power snapshots
 * forwarded to the engine, and the queue's pause, resume, cancel and retry
 * over the real engine and library store (in memory).
 */
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEventBus,
  err,
  JobQueueToken,
  JobStoreToken,
  newId,
  ok,
  systemClock,
  UnknownError,
  type JobId,
  type JobRequest,
  type PowerSnapshot,
  type TaalcutEvent,
  type UtilityName,
} from '@taalcut/core';
import { defineJob, fromJobKind, PRIORITY_VALUES } from '@taalcut/jobs';
import { createJobRepository, JOB_PRIORITY_VALUES } from '@taalcut/library';
import { mediaProbeJob } from '@taalcut/media';
import { forwardPower } from '../src/main/composition/main-wiring';
import type { PowerState } from '../src/main/power/power-state';
import { forwardedPower, jobEventSink } from '../src/utility/roots/job-engine-glue';
import { composeJobs } from '../src/utility/roots/jobs-root';
import { housekeeping } from '../src/utility/roots/library-jobs';
import { JobEngineToken, LibraryDatabaseToken } from '../src/shared/tokens';
import { testConfig } from './helpers/roots';

const summary = (id: JobId, attempts = 0) => ({
  id,
  kind: 'demo.wait',
  state: 'queued' as const,
  priority: 0,
  resourceClass: 'cpu' as const,
  attempts,
  maxAttempts: 3,
  projectId: null,
});

describe('jobEventSink', () => {
  it('turns engine events into job.stateChanged and job.progress', () => {
    const bus = createEventBus({ clock: systemClock });
    const seen: TaalcutEvent[] = [];
    bus.onAny((event) => seen.push(event));
    const log = vi.fn();
    const sink = jobEventSink(bus, log);
    const id = newId<'Job'>();
    sink.emit({ type: 'job.enqueued', job: summary(id) });
    sink.emit({ type: 'job.started', job: summary(id, 1) });
    sink.emit({ type: 'job.progress', jobId: id, kind: 'demo.wait', fraction: 0.5 });
    sink.emit({ type: 'job.paused', job: summary(id, 1) });
    sink.emit({ type: 'job.resumed', job: summary(id, 1) });
    sink.emit({
      type: 'job.failed',
      job: summary(id, 1),
      error: UnknownError(),
      willRetry: true,
      retryAt: 10,
    });
    sink.emit({ type: 'job.released', job: summary(id, 1), reason: 'shutdown' });
    sink.emit({ type: 'job.cancelled', job: summary(id, 1) });
    sink.emit({ type: 'queue.paused' });
    sink.emit({ type: 'queue.store_error', error: UnknownError() });
    expect(seen.map((event) => [event.type, 'to' in event.payload ? event.payload.to : 'progress'])).toEqual([
      ['job.stateChanged', 'queued'],
      ['job.stateChanged', 'running'],
      ['job.progress', 'progress'],
      ['job.stateChanged', 'paused'],
      ['job.stateChanged', 'queued'],
      ['job.stateChanged', 'queued'],
      ['job.stateChanged', 'queued'],
      ['job.stateChanged', 'cancelled'],
    ]);
    expect(seen[1]?.payload).toMatchObject({ from: 'queued', attempt: 1 });
    expect(seen[5]?.payload).toMatchObject({ error: { code: 'core.unknown' } });
    expect(log).toHaveBeenCalledWith('[jobs] store error: core.unknown');
  });
});

describe('power', () => {
  it('main sends the jobs process its snapshot on connect and on every change', async () => {
    const connected = new Set<(process: UtilityName) => void>();
    const sent: PowerSnapshot[] = [];
    const host = {
      client: () => ({ power: { update: async (snapshot: PowerSnapshot) => void sent.push(snapshot) } }),
      onConnected: (listener: (process: UtilityName) => void) => {
        connected.add(listener);
        return () => connected.delete(listener);
      },
    };
    const monitor = new EventEmitter();
    let snapshot: PowerSnapshot = { onBattery: false, thermalState: 'nominal' };
    const power: PowerState = {
      current: () => snapshot,
      onChange: (listener) => {
        monitor.on('change', listener);
        return () => monitor.off('change', listener);
      },
    };
    const stop = forwardPower(host as never, power);
    for (const listener of connected) listener('agent');
    for (const listener of connected) listener('jobs');
    snapshot = { onBattery: true, thermalState: 'serious' };
    monitor.emit('change', snapshot);
    await Promise.resolve();
    expect(sent).toEqual([
      { onBattery: false, thermalState: 'nominal' },
      { onBattery: true, thermalState: 'serious' },
    ]);
    stop();
    monitor.emit('change', snapshot);
    expect(connected.size).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it('the jobs process tells the engine only about real changes', () => {
    const { power, apply } = forwardedPower();
    const changed = vi.fn();
    const off = power.onChange(changed);
    apply({ onBattery: false, thermalState: 'nominal' });
    apply({ onBattery: true, thermalState: 'fair' });
    expect(changed).toHaveBeenCalledOnce();
    expect([power.onBattery, power.thermalState]).toEqual([true, 'fair']);
    off();
  });
});

describe('the job queue over the engine', () => {
  const roots: { dispose(): Promise<void> }[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await root.dispose();
  });

  it('pauses, resumes, cancels and retries through the engine and the library store', async () => {
    const root = composeJobs(testConfig('jobs'), { pid: 1, jobs: [] });
    roots.push(root.container);
    const engine = root.container.resolve(JobEngineToken);
    const queue = root.container.resolve(JobQueueToken);
    engine.register(
      defineJob({ kind: 'demo.fail', resourceClass: 'cpu', maxAttempts: 1, handler: async () => ok(1) }),
    );
    // Not started: jobs stay queued, so state changes are deterministic.
    const queued = await queue.enqueue({ kind: 'demo.fail', input: {}, idempotencyKey: 'k' });
    if (!queued.ok) throw new Error(queued.error.code);
    const id = queued.value.id;
    expect(await queue.pause(id)).toMatchObject({ ok: true, value: { state: 'paused' } });
    expect(await queue.resume(id)).toMatchObject({ ok: true, value: { state: 'queued' } });
    expect(await queue.cancel(id)).toMatchObject({ ok: true, value: { state: 'cancelled' } });
    expect(await queue.pause(newId<'Job'>())).toMatchObject({ ok: false });

    // A failed job comes back queued, with its attempts again.
    const store = root.container.resolve(JobStoreToken);
    const failed = await queue.enqueue({ kind: 'demo.fail', input: {}, notBefore: 1 });
    if (!failed.ok) throw new Error(failed.error.code);
    const record = await store.get(failed.value.id);
    if (!record.ok) throw new Error(record.error.code);
    await store.update({ ...record.value, state: 'failed', finishedAt: 2 }, 'queued');
    const retried = await queue.retry(failed.value.id);
    expect(retried).toMatchObject({ ok: true, value: { state: 'queued', error: null, maxAttempts: 2 } });
  });

  it('stores core priorities on one scale, whichever writer enqueues', async () => {
    const root = composeJobs(testConfig('jobs'), { pid: 1, jobs: [] });
    roots.push(root.container);
    const engine = root.container.resolve(JobEngineToken);
    const queue = root.container.resolve(JobQueueToken);
    const leases = createJobRepository(root.container.resolve(LibraryDatabaseToken));
    const io = (kind: string) => defineJob({ kind, resourceClass: 'io', handler: async () => ok(1) });
    for (const kind of ['demo.hash', 'demo.sweep']) engine.register(io(kind));
    engine.register(fromJobKind(mediaProbeJob, async () => ok(null as never)));

    // A hash the user waits for (high through the glue), then a probe (a `high` kind) queued after it.
    const hash = await queue.enqueue({ kind: 'demo.hash', input: {}, priority: 'high' });
    const probe = await engine.enqueue(mediaProbeJob.kind, { path: '/a.mov' });
    const sweep = await queue.enqueue({ kind: 'demo.sweep', input: {}, priority: 'low' });
    if (!hash.ok || !probe.ok || !sweep.ok) throw new Error('enqueue failed');
    const stored = (id: JobId) => leases.get(id);
    expect(stored(hash.value.id)).toMatchObject({ ok: true, value: { priority: PRIORITY_VALUES.high } });
    expect(stored(probe.value.job.id)).toMatchObject({ ok: true, value: { priority: PRIORITY_VALUES.high } });
    expect(stored(sweep.value.id)).toMatchObject({ ok: true, value: { priority: PRIORITY_VALUES.low } });
    expect(JOB_PRIORITY_VALUES).toEqual(PRIORITY_VALUES);
    // Same class, so the older (the boosted hash) is claimed first; housekeeping last.
    const order = [1, 2, 3].map(() => leases.claimNext({ owner: 't', leaseMs: 60_000 }));
    expect(order.map((claim) => (claim.ok ? claim.value?.kind : claim.error.code))).toEqual([
      'demo.hash',
      'media.probe',
      'demo.sweep',
    ]);
  });

  it('enqueues the daily sweep and collect at low priority', async () => {
    const requests: JobRequest[] = [];
    const queue = { enqueue: async (request: JobRequest) => (requests.push(request), err(UnknownError())) };
    await housekeeping(queue, Date.UTC(2026, 9, 13));
    expect(requests.map((r) => [r.kind, r.priority, r.idempotencyKey])).toEqual([
      ['library.sweepStaging', 'low', 'library.sweepStaging:2026-10-13'],
      ['library.collect', 'low', 'library.collect:2026-10-13'],
    ]);
  });
});
