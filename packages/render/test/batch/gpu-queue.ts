// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs queue as a batch uses it, for render's integration tests (render may not import @taalcut/jobs,
 * whose own tests cover the queue): requests are recorded, a key already queued is the same job, and `drain`
 * runs the queued jobs of the registered kinds in priority order (high, normal, low; first in first out
 * within one), one at a time, as the `gpu` resource does. Each run gets a real signal and progress callback,
 * and the progress each job reported is kept for assertions.
 */
import {
  JOB_PRIORITIES,
  newId,
  ok,
  type JobEnqueuer,
  type JobId,
  type JobPriority,
  type JobProgress,
  type JobRegistration,
  type JobRequest,
  type PublicJobSnapshot,
  type Result,
} from '@taalcut/core';

export interface QueuedJob {
  readonly id: JobId;
  readonly request: JobRequest;
  readonly priority: JobPriority;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  /** Every progress report, with the wall time it arrived. */
  readonly progress: { readonly at: number; readonly progress: JobProgress }[];
  result?: Result<unknown>;
}

export interface GpuQueue extends JobEnqueuer {
  readonly jobs: QueuedJob[];
  /** Runs every queued job of a registered kind, one at a time; `onProgress` sees each report as it comes. */
  drain(onProgress?: (job: QueuedJob, progress: JobProgress) => void): Promise<void>;
}

const rank = (priority: JobPriority) => JOB_PRIORITIES.length - JOB_PRIORITIES.indexOf(priority);

export function gpuQueue(registrations: readonly JobRegistration[]): GpuQueue {
  const jobs: QueuedJob[] = [];
  const snapshot = (job: QueuedJob): PublicJobSnapshot => ({
    id: job.id,
    kind: job.request.kind,
    state: 'queued',
    priority: job.priority,
    resource: 'gpu',
    projectId: job.request.projectId ?? null,
    idempotencyKey: job.request.idempotencyKey ?? null,
    parentId: null,
    attempt: 1,
    maxAttempts: 2,
    progress: null,
    error: null,
    createdAt: 1,
    updatedAt: 1,
    startedAt: null,
    finishedAt: null,
    nextAttemptAt: null,
  });
  const next = () =>
    jobs
      .filter(
        (job) =>
          job.state === 'queued' &&
          registrations.some(
            (entry) => entry.kind.kind === job.request.kind && entry.kind.resource === 'gpu',
          ),
      )
      .sort((a, b) => rank(b.priority) - rank(a.priority) || jobs.indexOf(a) - jobs.indexOf(b))[0];
  return {
    jobs,
    async enqueue(request) {
      const same = request.idempotencyKey
        ? jobs.find((job) => job.request.idempotencyKey === request.idempotencyKey)
        : undefined;
      if (same) return ok(snapshot(same));
      const job: QueuedJob = {
        id: newId<'Job'>(),
        request,
        priority: request.priority ?? 'normal',
        state: 'queued',
        progress: [],
      };
      jobs.push(job);
      return ok(snapshot(job));
    },
    async drain(onProgress) {
      for (let job = next(); job; job = next()) {
        const registration = registrations.find((entry) => entry.kind.kind === job?.request.kind);
        if (!registration) break;
        const running = job;
        running.state = 'running';
        const parsed = registration.kind.input.safeParse(running.request.input);
        if (!parsed.success) throw new Error(`job ${running.request.kind}: ${parsed.error.message}`);
        const result = await registration.handler(parsed.data, {
          jobId: running.id,
          projectId: running.request.projectId ?? null,
          attempt: 1,
          signal: new AbortController().signal,
          progress: (progress) => {
            running.progress.push({ at: performance.now(), progress });
            onProgress?.(running, progress);
          },
        });
        running.result = result;
        running.state = result.ok
          ? 'succeeded'
          : result.error.code === 'core.cancelled'
            ? 'cancelled'
            : 'failed';
      }
    },
  };
}

/** Each job's capture windows (wall times between entering `capturing` and leaving it). */
export function captureWindows(
  jobs: readonly QueuedJob[],
  stageKey: string,
): { start: number; end: number }[] {
  const windows: { start: number; end: number }[] = [];
  for (const job of jobs) {
    let start: number | null = null;
    for (const { at, progress } of job.progress) {
      if (progress.stageKey === stageKey && start === null) start = at;
      else if (progress.stageKey !== undefined && progress.stageKey !== stageKey && start !== null) {
        windows.push({ start, end: at });
        start = null;
      }
    }
    const last = job.progress.at(-1);
    if (start !== null && last) windows.push({ start, end: last.at });
  }
  return windows;
}

/** The most windows open at one instant. */
export function maxOverlap(windows: readonly { start: number; end: number }[]): number {
  const edges = windows.flatMap((window) => [
    { at: window.start, open: 1 },
    { at: window.end, open: -1 },
  ]);
  // A window that closes at the instant another opens doesn't overlap it.
  edges.sort((a, b) => a.at - b.at || a.open - b.open);
  let open = 0;
  let most = 0;
  for (const edge of edges) {
    open += edge.open;
    most = Math.max(most, open);
  }
  return most;
}
