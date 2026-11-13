// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test support for the indexing pipeline (tests only; dependency-cruiser keeps it out of app and package code): a
 * minimal job queue, core's JobQueue over the library's lease repository with handlers run one at a time and
 * `job.stateChanged` events like the jobs engine's, and the loop that polls, settles and runs jobs until nothing is
 * left. The library may only import core, so its own tests don't use @taalcut/jobs; the desktop's tests run real
 * job registrations through it.
 */
import {
  err,
  NotFoundError,
  ok,
  toTaalcutError,
  unwrap,
  type EventBus,
  type JobId,
  type JobQueue,
  type JobSnapshot,
  type JobState,
  type Result,
} from '@taalcut/core';
import {
  createJobRepository,
  JOB_PRIORITY_VALUES,
  toJobRecord,
  type Job,
  type LibraryDatabase,
} from './index';

export type StubHandler = (input: unknown, jobId: JobId) => Promise<Result<unknown>> | Result<unknown>;

const PRIORITY = JOB_PRIORITY_VALUES;

export interface TestQueue extends JobQueue {
  /** Runs the highest-priority due job, if any. Returns its kind, or null when nothing was queued. */
  runNext(): Promise<string | null>;
  /** The kinds run so far, in order, as `<kind> <first input field>`. */
  readonly ran: string[];
}

function snapshot(row: Job): JobSnapshot {
  const { input: _input, ...rest } = unwrap(toJobRecord(row));
  return rest;
}

export function createTestQueue(
  db: LibraryDatabase,
  events: EventBus,
  handlers: Readonly<Record<string, StubHandler>>,
): TestQueue {
  const repo = createJobRepository(db);
  const ran: string[] = [];
  const emit = (row: Job, from: JobState | null) =>
    events.emit('job.stateChanged', {
      jobId: row.id,
      kind: row.kind,
      projectId: row.projectId,
      from,
      to: row.state,
      attempt: Math.max(1, row.attempts),
    });
  const change = (id: JobId, fn: (id: JobId) => Result<Job>): Result<JobSnapshot> => {
    const before = repo.get(id);
    if (!before.ok) return before;
    const after = fn(id);
    if (!after.ok) return after;
    if (after.value.state !== before.value.state) emit(after.value, before.value.state);
    return ok(snapshot(after.value));
  };
  return {
    ran,
    async enqueue(request) {
      if (!handlers[request.kind]) return err(NotFoundError({ entity: 'job_kind', id: request.kind }));
      const added = repo.enqueue({
        kind: request.kind,
        payload: request.input,
        resourceClass: 'cpu',
        priority: PRIORITY[request.priority ?? 'normal'],
        maxAttempts: 3,
        ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
        ...(request.orderKey !== undefined ? { orderKey: request.orderKey } : {}),
      });
      if (!added.ok) return added;
      if (added.value.created) emit(added.value.job, null);
      return ok(snapshot(added.value.job));
    },
    async get(id) {
      const row = repo.get(id);
      return row.ok ? ok(snapshot(row.value)) : row;
    },
    async list(filter = {}) {
      return ok(repo.list({ ...(filter.states ? { states: filter.states } : {}) }).map(snapshot));
    },
    pause: async (id) => change(id, (j) => repo.pause(j)),
    resume: async (id) => change(id, (j) => repo.resume(j)),
    cancel: async (id) => change(id, (j) => repo.cancel(j)),
    retry: async (id) => err(NotFoundError({ entity: 'job', id })),
    async runNext() {
      const claimed = unwrap(repo.claimNext({ owner: 'test', leaseMs: 60_000 }));
      if (!claimed) return null;
      emit(claimed, 'queued');
      const input = claimed.payload as Record<string, unknown>;
      ran.push(`${claimed.kind} ${String(Object.values(input ?? {})[0] ?? '')}`);
      let outcome: Result<unknown>;
      try {
        outcome = await handlers[claimed.kind]!(claimed.payload, claimed.id);
      } catch (cause) {
        outcome = err(toTaalcutError(cause));
      }
      const done = outcome.ok
        ? repo.complete(claimed.id, 'test', outcome.value)
        : repo.fail(claimed.id, 'test', outcome.error);
      // Paused or cancelled meanwhile: the lease is gone and the result is dropped, like the engine.
      if (done.ok) emit(done.value, 'running');
      return claimed.kind;
    },
  };
}

/** Polls, settles and runs jobs until nothing is left to do (or `max` jobs ran). */
export async function runPipeline(
  pipeline: { tick(): Promise<void>; idle(): Promise<void> },
  queue: TestQueue,
  max = 1000,
): Promise<number> {
  let jobs = 0;
  for (;;) {
    await pipeline.tick();
    await pipeline.idle();
    const kind = await queue.runNext();
    await pipeline.idle();
    if (kind === null) {
      await pipeline.tick();
      await pipeline.idle();
      if ((await queue.runNext()) === null) return jobs;
    }
    if (++jobs >= max) return jobs;
  }
}
