// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// FIX-LOSTRENDER, the jobs process's part: when an export job ends for good without its render, the render is
// settled; at start, renders with no export job left are stopped. (The owner, 2026-11-15: an export at "Waiting to
// start" for good.)
import {
  createEventBus,
  err,
  newId,
  NotFoundError,
  ok,
  TimeoutError,
  type JobId,
  type JobRecord,
  type JobState,
  type RenderId,
  type RenderRecord,
  type RenderStatus,
} from '@taalcut/core';
import { LOST_RENDER_GRACE_MS } from '@taalcut/render';
import { describe, expect, it } from 'vitest';
import {
  followEndedExports,
  settleLostRendersAtStart,
  type RenderSettleDeps,
} from '../src/utility/roots/render-settle';

const NOW = 10 * LOST_RENDER_GRACE_MS;

function world() {
  const bus = createEventBus({ clock: { now: () => NOW } });
  const renders = new Map<RenderId, RenderRecord>();
  const jobs = new Map<JobId, JobRecord>();
  const logged: string[] = [];
  const deps: RenderSettleDeps = {
    bus,
    clock: { now: () => NOW },
    log: (message) => logged.push(message),
    jobs: {
      get: async (id) => {
        const job = jobs.get(id);
        return job ? ok(job) : err(NotFoundError({ entity: 'job', id }));
      },
      list: async (filter = {}) =>
        ok(
          [...jobs.values()].filter(
            (job) => job.kind === filter.kind && (filter.states ?? []).includes(job.state),
          ),
        ),
    },
    store: {
      get: async (id) => {
        const record = renders.get(id);
        return record ? ok(record) : err(NotFoundError({ entity: 'render', id }));
      },
      list: async () => ok([...renders.values()]),
      update: async (id, patch) => {
        const next = { ...renders.get(id)!, ...patch } as RenderRecord;
        renders.set(id, next);
        return ok(next);
      },
    },
  };
  /** A render and its export job, as the queue would have stored them. */
  const exportOf = (status: RenderStatus, state: JobState, kind = 'render.export') => {
    const renderId = newId<'Render'>();
    const jobId = newId<'Job'>();
    renders.set(renderId, { id: renderId, status, createdAt: 1_000, finishedAt: null } as RenderRecord);
    jobs.set(jobId, {
      id: jobId,
      kind,
      state,
      input: { renderId, request: { anOlderShape: true } },
    } as JobRecord);
    return { renderId, jobId };
  };
  const moved = (jobId: JobId, from: JobState | null, to: JobState, extra: object = {}) =>
    bus.emit('job.stateChanged', {
      jobId,
      kind: jobs.get(jobId)?.kind ?? 'render.export',
      projectId: null,
      from,
      to,
      attempt: 1,
      ...extra,
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  return { deps, renders, jobs, logged, exportOf, moved, settle };
}

describe('an export job that ends without its render', () => {
  it('stops the render when the job is cancelled while it waits, and fails it with the job’s reason', async () => {
    const w = world();
    followEndedExports(w.deps);
    const waiting = w.exportOf('queued', 'cancelled');
    const paused = w.exportOf('queued', 'cancelled');
    const timedOut = w.exportOf('queued', 'failed');
    w.moved(waiting.jobId, 'queued', 'cancelled');
    w.moved(paused.jobId, 'paused', 'cancelled');
    w.moved(timedOut.jobId, 'running', 'failed', { error: TimeoutError({ ms: 1_800_000 }) });
    await w.settle();
    expect(w.renders.get(waiting.renderId)).toMatchObject({ status: 'cancelled', finishedAt: NOW });
    expect(w.renders.get(paused.renderId)).toMatchObject({ status: 'cancelled', finishedAt: NOW });
    expect(w.renders.get(timedOut.renderId)).toMatchObject({
      status: 'failed',
      finishedAt: NOW,
      error: { code: 'core.timeout' },
    });
    expect(w.logged).toEqual([]);
  });

  it('leaves a job cancelled while it ran to its handler, and everything that is not an ended export', async () => {
    const w = world();
    followEndedExports(w.deps);
    const running = w.exportOf('rendering', 'cancelled');
    const retrying = w.exportOf('queued', 'queued');
    const other = w.exportOf('queued', 'cancelled', 'audio.listen.analyse');
    const settled = w.exportOf('ready', 'failed');
    w.moved(running.jobId, 'running', 'cancelled');
    w.moved(retrying.jobId, 'running', 'queued', { error: TimeoutError({ ms: 1_800_000 }) });
    w.moved(other.jobId, 'queued', 'cancelled');
    w.moved(settled.jobId, 'running', 'failed');
    w.moved(newId<'Job'>(), 'queued', 'cancelled'); // a job the store no longer has
    await w.settle();
    expect(w.renders.get(running.renderId)?.status).toBe('rendering');
    expect(w.renders.get(retrying.renderId)?.status).toBe('queued');
    expect(w.renders.get(other.renderId)?.status).toBe('queued');
    expect(w.renders.get(settled.renderId)?.status).toBe('ready');
  });

  it('stops listening when asked', async () => {
    const w = world();
    const stop = followEndedExports(w.deps);
    stop();
    const waiting = w.exportOf('queued', 'cancelled');
    w.moved(waiting.jobId, 'queued', 'cancelled');
    await w.settle();
    expect(w.renders.get(waiting.renderId)?.status).toBe('queued');
  });
});

describe('at start', () => {
  it('stops the renders with no export job left and keeps the ones a job will still run', async () => {
    const w = world();
    const lost = w.exportOf('queued', 'cancelled');
    const orphan = w.exportOf('checking', 'succeeded');
    const waiting = w.exportOf('queued', 'queued');
    const taken = w.exportOf('rendering', 'running');
    const held = w.exportOf('queued', 'paused');
    const done = w.exportOf('ready', 'succeeded');
    const settled = await settleLostRendersAtStart(w.deps);
    expect([...settled].sort()).toEqual([lost.renderId, orphan.renderId].sort());
    expect(w.renders.get(lost.renderId)).toMatchObject({ status: 'cancelled', finishedAt: NOW });
    expect(w.renders.get(orphan.renderId)?.status).toBe('cancelled');
    for (const kept of [waiting, taken, held]) expect(w.renders.get(kept.renderId)?.finishedAt).toBeNull();
    expect(w.renders.get(done.renderId)?.status).toBe('ready');
    expect(w.logged).toEqual(['[render] 2 render(s) had no export job left: stopped']);
  });
});
