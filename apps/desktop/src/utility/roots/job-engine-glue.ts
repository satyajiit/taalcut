// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's glue between @taalcut/jobs and core: the engine as
 * core's JobQueue (what jobsRouter serves the renderer), the engine's events
 * as core's job.* events, and a PowerState fed by main's snapshots.
 *
 * Reads go through core's JobStore port (library), which returns snapshots;
 * state changes go through the engine, which aborts a running handler first.
 */
import {
  ConflictError,
  err,
  ok,
  type Result,
  type EventBus,
  type JobId,
  type JobQueue,
  type JobState,
  type JobStore,
  type PowerSnapshot,
  type ProjectId,
  type TaalcutError,
} from '@taalcut/core';
import {
  PRIORITY_VALUES,
  type JobEngine,
  type JobEvent,
  type JobEventSink,
  type JobRecord as EngineJob,
  type JobStore as EngineStore,
  type PowerState,
} from '@taalcut/jobs';
import type { Job, JobLeaseRepository } from '@taalcut/library';

/**
 * The library's lease repository as the engine's store. One difference: a
 * row written through core's JobStore port may have no next_run_at (due
 * since it was created); the engine wants a time, so it gets createdAt.
 */
export function engineStore(repo: JobLeaseRepository): EngineStore {
  const fix = (job: Job): EngineJob => ({ ...job, nextRunAt: job.nextRunAt ?? job.createdAt });
  const one = (result: Result<Job>): Result<EngineJob> => (result.ok ? ok(fix(result.value)) : result);
  return {
    enqueue(input) {
      const result = repo.enqueue(input);
      return result.ok ? ok({ job: fix(result.value.job), created: result.value.created }) : result;
    },
    get: (id) => one(repo.get(id)),
    claimNext(claim) {
      const result = repo.claimNext(claim);
      return result.ok ? ok(result.value && fix(result.value)) : result;
    },
    heartbeat: (id, owner, update) => one(repo.heartbeat(id, owner, update)),
    complete: (id, owner, output) => one(repo.complete(id, owner, output)),
    fail: (id, owner, error, options) => one(repo.fail(id, owner, error, options)),
    release: (id, owner) => one(repo.release(id, owner)),
    pause: (id) => one(repo.pause(id)),
    resume: (id) => one(repo.resume(id)),
    cancel: (id) => one(repo.cancel(id)),
    recoverExpiredLeases() {
      const result = repo.recoverExpiredLeases();
      return result.ok ? ok(result.value.map(fix)) : result;
    },
    list: (options) => repo.list(options).map(fix),
  };
}

/** Core's JobQueue over the engine (changes) and core's JobStore (reads). */
export function engineJobQueue(engine: JobEngine, store: JobStore, now: () => number = Date.now): JobQueue {
  const snapshot = async (id: JobId) => store.get(id);
  const change = async (id: JobId, run: (id: JobId) => ReturnType<JobEngine['pause']>) => {
    const changed = await run(id);
    return changed.ok ? snapshot(id) : changed;
  };
  return {
    async enqueue(request) {
      const queued = await engine.enqueue(request.kind, request.input, {
        // One scale with the kinds' own (`fromJobKind`); no priority keeps the kind's.
        ...(request.priority ? { priority: PRIORITY_VALUES[request.priority] } : {}),
        ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
        ...(request.notBefore === undefined ? {} : { runAt: request.notBefore }),
        ...(request.orderKey === undefined ? {} : { orderKey: request.orderKey }),
        projectId: request.projectId ?? null,
      });
      return queued.ok ? snapshot(queued.value.job.id) : queued;
    },
    get: snapshot,
    list: (filter) => store.list(filter),
    pause: (id) => change(id, (job) => engine.pause(job)),
    resume: (id) => change(id, (job) => engine.resume(job)),
    cancel: (id) => change(id, (job) => engine.cancel(job)),
    /** A failed job goes back to the queue, due now, with as many attempts again as it had. */
    async retry(id) {
      const current = await store.get(id);
      if (!current.ok) return current;
      const job = current.value;
      if (job.state !== 'failed') {
        return err(ConflictError({ entity: 'job', id }, { detail: `can't retry a ${job.state} job` }));
      }
      const at = now();
      return store.update(
        {
          ...job,
          state: 'queued',
          error: null,
          maxAttempts: job.attempt + job.maxAttempts,
          nextAttemptAt: at,
          finishedAt: null,
          updatedAt: at,
        },
        'failed',
      );
    },
  };
}

interface Known {
  readonly kind: string;
  readonly projectId: ProjectId | null;
  state: JobState;
}

/** The engine's events as core's `job.stateChanged` and `job.progress` on this process's bus. */
export function jobEventSink(bus: EventBus, log: (message: string) => void = console.warn): JobEventSink {
  const known = new Map<JobId, Known>();
  const moved = (
    job: { id: JobId; kind: string; projectId: ProjectId | null; attempts: number },
    to: JobState,
    error?: TaalcutError,
  ) => {
    const from = known.get(job.id)?.state ?? null;
    known.set(job.id, { kind: job.kind, projectId: job.projectId, state: to });
    if (to === 'succeeded' || to === 'failed' || to === 'cancelled') known.delete(job.id);
    bus.emit('job.stateChanged', {
      jobId: job.id,
      kind: job.kind,
      projectId: job.projectId,
      from,
      to,
      attempt: Math.max(1, job.attempts),
      ...(error === undefined ? {} : { error }),
    });
  };
  return {
    emit(event: JobEvent) {
      switch (event.type) {
        case 'job.enqueued':
        case 'job.recovered':
          return moved(event.job, event.job.state);
        case 'job.started':
          return moved(event.job, 'running');
        case 'job.succeeded':
          return moved(event.job, 'succeeded');
        case 'job.failed':
          return moved(event.job, event.willRetry ? 'queued' : 'failed', event.error);
        case 'job.paused':
          return moved(event.job, 'paused');
        case 'job.resumed':
        case 'job.released':
          return moved(event.job, 'queued');
        case 'job.cancelled':
          return moved(event.job, 'cancelled');
        case 'job.progress': {
          const job = known.get(event.jobId);
          bus.emit('job.progress', {
            jobId: event.jobId,
            kind: event.kind,
            projectId: job?.projectId ?? null,
            progress: { fraction: event.fraction },
          });
          return;
        }
        case 'queue.store_error':
          log(`[jobs] store error: ${event.error.code}`);
          return;
        default:
          return;
      }
    },
  };
}

/** The engine's PowerState, holding the latest snapshot main sent. On AC and nominal until the first. */
export function forwardedPower(): { readonly power: PowerState; apply(snapshot: PowerSnapshot): void } {
  let current: PowerSnapshot = { onBattery: false, thermalState: 'nominal' };
  const listeners = new Set<() => void>();
  return {
    power: {
      get onBattery() {
        return current.onBattery;
      },
      get thermalState() {
        return current.thermalState;
      },
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    apply(snapshot) {
      if (snapshot.onBattery === current.onBattery && snapshot.thermalState === current.thermalState) return;
      current = snapshot;
      for (const listener of [...listeners]) listener();
    },
  };
}
