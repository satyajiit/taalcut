// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Fakes for the write side: timelines in memory, a recording job queue, render rows. */
import {
  err,
  newId,
  NotFoundError,
  ok,
  timelineSchema,
  type CommandOrigin,
  type JobEnqueuer,
  type JobRequest,
  type ProjectId,
  type PublicJobSnapshot,
  type RenderId,
  type RenderRecord,
  type Timeline,
  type TaalcutError,
} from '@taalcut/core';
import type { TimelineAccess } from '../../src/ports';

export const UI: CommandOrigin = { source: 'ui', actor: 'user' };
export const AGENT: CommandOrigin = { source: 'agent', actor: 'agent:run' };

/** Timelines in memory: every update is the next revision and must still be a valid document. */
export function memoryTimelines(...initial: Timeline[]): TimelineAccess & { put(timeline: Timeline): void } {
  const stored = new Map(initial.map((timeline) => [timeline.id, timeline]));
  return {
    put: (timeline) => stored.set(timeline.id, timeline),
    get: async (id) => {
      const timeline = stored.get(id);
      return timeline ? ok(timeline) : err(NotFoundError({ entity: 'timeline', id }));
    },
    update: async (id, mutate) => {
      const timeline = stored.get(id);
      if (!timeline) return err(NotFoundError({ entity: 'timeline', id }));
      const next = timelineSchema.parse({ ...mutate(timeline), revision: timeline.revision + 1 });
      stored.set(id, next);
      return ok(next);
    },
  };
}

/** One timeline in memory, its latest revision at hand. */
export function oneTimeline(initial: Timeline): TimelineAccess & { current(): Timeline } {
  const timelines = memoryTimelines(initial);
  let latest = initial;
  return {
    current: () => latest,
    get: timelines.get,
    update: async (id, mutate) => {
      const updated = await timelines.update(id, mutate);
      if (updated.ok) latest = updated.value;
      return updated;
    },
  };
}

/** A queue that records what was enqueued and answers with a queued job, or with `failWith`. */
export function recordingEnqueuer(): JobEnqueuer & { requests: JobRequest[]; failWith?: TaalcutError } {
  const queue: JobEnqueuer & { requests: JobRequest[]; failWith?: TaalcutError } = {
    requests: [],
    async enqueue(request) {
      queue.requests.push(request);
      if (queue.failWith) return err(queue.failWith);
      const at = 1;
      const snapshot: PublicJobSnapshot = {
        id: newId<'Job'>(),
        kind: request.kind,
        state: 'queued',
        priority: 'normal',
        resource: 'gpu',
        projectId: request.projectId ?? null,
        idempotencyKey: request.idempotencyKey ?? null,
        parentId: null,
        attempt: 1,
        maxAttempts: 2,
        progress: null,
        error: null,
        createdAt: at,
        updatedAt: at,
        startedAt: null,
        finishedAt: null,
        nextAttemptAt: null,
      };
      return ok(snapshot);
    },
  };
  return queue;
}

/** A stored render row; only what a test sets matters. */
export function renderRow(
  overrides: Partial<RenderRecord & { requestKey: string }> & { projectId: ProjectId },
): RenderRecord & { requestKey: string } {
  const id: RenderId = overrides.id ?? newId<'Render'>();
  const timelineId = overrides.timelineId ?? newId<'Timeline'>();
  const rate = { num: 30, den: 1 } as RenderRecord['rate'];
  const captions = { burnIn: true, sidecars: [] as ('srt' | 'vtt')[] };
  return {
    id,
    timelineId,
    timelineRevision: 1,
    presetId: 'device',
    status: 'queued',
    jobId: null,
    progress: null,
    name: 'Render',
    width: 1080,
    height: 1920,
    rate,
    durationFrames: 90,
    bytes: null,
    music: 'platformSound',
    captions,
    qa: null,
    supersedes: null,
    notify: false,
    error: null,
    credentials: { added: false, state: null },
    batchId: null,
    createdAt: 1,
    finishedAt: null,
    deletedAt: null,
    request: {
      projectId: overrides.projectId,
      timelineId,
      presetId: 'device',
      captions,
      notify: false,
      contentCredentials: { add: false },
      includeBumpers: true,
    },
    filePath: null,
    compositionHash: null,
    qaReport: null,
    requestKey: 'key',
    ...overrides,
  };
}
