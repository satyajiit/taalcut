// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The job contract: state machine, retry policy, kind definitions, schemas and the IPC contract. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  callRpc,
  canTransitionJob,
  connectRpc,
  DEFAULT_RETRY,
  defineJobKind,
  implementContract,
  isTerminalJobState,
  jobProgressSchema,
  jobRequestSchema,
  jobsContract,
  jobSnapshotSchema,
  newId,
  NO_RETRY,
  NotFoundError,
  retryDelay,
  serveRpc,
  TimeoutError,
  unwrapRpc,
  err,
  ok,
  type JobSnapshot,
} from '@taalcut/core';
import { channel } from './helpers/ports';

const snapshot = (overrides: Partial<JobSnapshot> = {}): JobSnapshot => ({
  id: newId<'Job'>(),
  kind: 'media.probe',
  state: 'running',
  priority: 'high',
  resource: 'io',
  projectId: null,
  idempotencyKey: 'sha256:abc',
  parentId: null,
  attempt: 1,
  maxAttempts: 3,
  progress: { fraction: 0.5, completed: 50, total: 100, unit: 'frames' },
  error: null,
  createdAt: 1,
  updatedAt: 2,
  startedAt: 2,
  finishedAt: null,
  nextAttemptAt: null,
  ...overrides,
});

describe('job states', () => {
  it('allows only the documented transitions', () => {
    expect(canTransitionJob('queued', 'running')).toBe(true);
    expect(canTransitionJob('running', 'queued')).toBe(true);
    expect(canTransitionJob('paused', 'queued')).toBe(true);
    expect(canTransitionJob('failed', 'queued')).toBe(true);
    expect(canTransitionJob('succeeded', 'queued')).toBe(false);
    expect(canTransitionJob('cancelled', 'running')).toBe(false);
    expect(canTransitionJob('paused', 'running')).toBe(false);
    expect(['succeeded', 'failed', 'cancelled'].every((s) => isTerminalJobState(s as never))).toBe(true);
    expect(isTerminalJobState('paused')).toBe(false);
  });
});

describe('retry policy', () => {
  const retryable = TimeoutError({ ms: 5 });

  it('retries only retryable errors, up to maxAttempts', () => {
    expect(retryDelay(DEFAULT_RETRY, 1, NotFoundError())).toBeNull();
    expect(retryDelay(NO_RETRY, 1, retryable)).toBeNull();
    expect(retryDelay(DEFAULT_RETRY, 3, retryable)).toBeNull();
  });

  it('backs off exponentially with a cap, and jitters when asked', () => {
    const policy = {
      maxAttempts: 10,
      backoff: { kind: 'exponential', initialMs: 100, maxMs: 1_000, factor: 2, jitter: false },
    } as const;
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelay(policy, attempt, retryable))).toEqual([
      100, 200, 400, 800, 1_000,
    ]);
    expect(retryDelay(DEFAULT_RETRY, 2, retryable, () => 0.5)).toBe(1_000);
    expect(retryDelay({ maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 250 } }, 1, retryable)).toBe(250);
  });
});

describe('job kinds', () => {
  it('fills defaults and rejects bad kind names', () => {
    const probe = defineJobKind({
      kind: 'media.probe',
      input: z.object({ path: z.string() }),
      output: z.object({ durationMs: z.number() }),
      resource: 'io',
      idempotencyKey: ({ path }) => `probe:${path}`,
    });
    expect(probe).toMatchObject({ priority: 'normal', retry: DEFAULT_RETRY, resumable: true });
    expect(probe.idempotencyKey?.({ path: '/a.mov' })).toBe('probe:/a.mov');
    expect(() =>
      defineJobKind({ kind: 'Probe', input: z.null(), output: z.null(), resource: 'cpu' }),
    ).toThrow(/Invalid job kind/);
  });
});

describe('job schemas', () => {
  it('validates requests, snapshots and progress', () => {
    expect(
      jobRequestSchema.safeParse({ kind: 'media.probe', input: { path: '/a' }, priority: 'high' }).success,
    ).toBe(true);
    expect(jobRequestSchema.safeParse({ kind: 'probe', input: null }).success).toBe(false);
    const job = snapshot({ state: 'failed', error: TimeoutError({ ms: 10 }) });
    expect(jobSnapshotSchema.parse(job)).toEqual(job);
    expect(jobSnapshotSchema.safeParse({ ...job, attempt: 0 }).success).toBe(false);
    expect(jobProgressSchema.safeParse({ fraction: null }).success).toBe(true);
    expect(jobProgressSchema.safeParse({ fraction: 1.5 }).success).toBe(false);
  });
});

describe('jobs over IPC', () => {
  it('lets the renderer list and cancel jobs through the contract', async () => {
    const jobs = new Map<string, JobSnapshot>();
    const running = snapshot();
    jobs.set(running.id, running);
    const os = implementContract(jobsContract);
    const find = (id: string) => {
      const job = jobs.get(id);
      return job ? ok(job) : err(NotFoundError({ entity: 'job', id }));
    };
    const set = (id: string, state: JobSnapshot['state']) => {
      const job = unwrapRpc(find(id));
      jobs.set(id, { ...job, state });
      return jobs.get(id)!;
    };
    const router = os.router({
      get: os.get.handler(({ input }) => unwrapRpc(find(input.id))),
      list: os.list.handler(() => [...jobs.values()]),
      pause: os.pause.handler(({ input }) => set(input.id, 'paused')),
      resume: os.resume.handler(({ input }) => set(input.id, 'queued')),
      cancel: os.cancel.handler(({ input }) => set(input.id, 'cancelled')),
      retry: os.retry.handler(({ input }) => set(input.id, 'queued')),
    });
    const { port1, port2 } = channel();
    serveRpc(router, port1, { context: {} });
    const { client } = connectRpc(jobsContract, port2, { peer: 'jobs' });

    expect(await client.list()).toHaveLength(1);
    expect((await client.cancel({ id: running.id })).state).toBe('cancelled');
    const missing = await callRpc(client.get({ id: newId<'Job'>() }));
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
    const bad = await callRpc(client.pause({ id: 'nope' as never }));
    expect(!bad.ok && bad.error.params).toEqual({ field: 'id' });
  });
});
