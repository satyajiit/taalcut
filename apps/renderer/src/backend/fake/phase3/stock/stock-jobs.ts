// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The stock fake's import jobs (`library.stockImport`): queued, running with two progress ticks, then succeeded
 * (the asset is in the library) or failed with the download's error, each step announced on the bus as the job
 * store does (job.stateChanged, job.progress). Cancel stops a job that hasn't finished.
 */
import {
  LIBRARY_JOB_KINDS,
  newId,
  type EventBus,
  type JobId,
  type JobState,
  type ProjectId,
  type TaalcutError,
} from '@taalcut/core';

export interface StockJob {
  readonly id: JobId;
  readonly projectId: ProjectId | null;
  state: JobState;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface StockJobs {
  /** Starts a job; `finish` decides how it ends (null: succeeded), and `done` runs once it succeeded. */
  start(projectId: ProjectId | null, finish: () => TaalcutError | null, done: () => void): StockJob;
  cancel(jobId: JobId): void;
  get(jobId: JobId): StockJob | undefined;
}

/** What a window sees of an error (core's publicErrorSchema): no `detail`. */
const publicOf = ({ detail: _detail, ...seen }: TaalcutError) => seen;

export function createStockJobs(events: EventBus, tickMs: number): StockJobs {
  const jobs = new Map<string, StockJob>();
  const kind = LIBRARY_JOB_KINDS.stockImport;

  function move(job: StockJob, to: JobState, error?: TaalcutError) {
    const from = jobs.has(job.id) && job.state !== to ? job.state : null;
    job.state = to;
    events.emit('job.stateChanged', {
      jobId: job.id,
      kind,
      projectId: job.projectId,
      from,
      to,
      attempt: 1,
      ...(error ? { error: publicOf(error) } : {}),
    });
  }

  return {
    start(projectId, finish, done) {
      const job: StockJob = { id: newId<'Job'>(), projectId, state: 'queued', timer: null };
      move(job, 'queued');
      jobs.set(job.id, job);
      const steps: (() => void)[] = [
        () => move(job, 'running'),
        () => events.emit('job.progress', { jobId: job.id, kind, projectId, progress: { fraction: 0.4 } }),
        () => events.emit('job.progress', { jobId: job.id, kind, projectId, progress: { fraction: 0.85 } }),
        () => {
          const error = finish();
          if (error) return move(job, 'failed', error);
          done();
          move(job, 'succeeded');
        },
      ];
      const next = () => {
        job.timer = null;
        const step = steps.shift();
        if (!step || job.state === 'cancelled') return;
        step();
        if (steps.length > 0) job.timer = setTimeout(next, tickMs);
      };
      job.timer = setTimeout(next, tickMs);
      return job;
    },
    cancel(jobId) {
      const job = jobs.get(jobId);
      if (!job || job.state === 'succeeded' || job.state === 'failed' || job.state === 'cancelled') return;
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
      move(job, 'cancelled');
    },
    get: (jobId) => jobs.get(jobId),
  };
}
