// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the agent process serves `appContract.comments` from (core's CommentsService, EDT1-CMT): a timeline's comments,
 * and a watch that yields them now and again after each change. A comment changes by its own commands
 * (`library.changed`, entity comment) and with its timeline, which moves comments with their anchors; both end in a
 * command on the timeline's project (`command.changed`), so the watch reads again on either and yields only when the
 * list differs.
 */
import {
  err,
  NotFoundError,
  ok,
  type AsyncResult,
  type CommentsService,
  type CommentStore,
  type EventBus,
  type ProjectId,
  type TimelineComment,
  type TimelineId,
  type TimelineStore,
} from '@taalcut/core';

export interface CommentsServiceDeps {
  readonly store: CommentStore;
  /** Which project a timeline is in, for its commands. */
  readonly timelines: Pick<TimelineStore, 'get'>;
  readonly events: Pick<EventBus, 'on'>;
}

/** Wakes a waiting watcher; a ring while nobody waits is kept (one is enough). */
function latch() {
  let rung = false;
  let resolve: (() => void) | null = null;
  return {
    ring() {
      rung = true;
      resolve?.();
      resolve = null;
    },
    wait: (): Promise<void> =>
      rung
        ? ((rung = false), Promise.resolve())
        : new Promise((done) => {
            resolve = () => {
              rung = false;
              done();
            };
          }),
  };
}

export function createCommentsService({ store, timelines, events }: CommentsServiceDeps): CommentsService {
  async function projectOf(timelineId: TimelineId): AsyncResult<ProjectId> {
    const stored = await timelines.get(timelineId);
    if (!stored.ok)
      return stored.error.code === 'core.not_found'
        ? err(NotFoundError({ entity: 'timeline', id: timelineId }))
        : stored;
    return ok(stored.value.summary.projectId);
  }

  async function* watch(timelineId: TimelineId, signal: AbortSignal): AsyncIterable<TimelineComment[]> {
    const project = await projectOf(timelineId);
    if (!project.ok) throw project.error;
    // Listening before the first read, so a change made while the caller holds the first list isn't missed.
    const wake = latch();
    const offChanged = events.on('library.changed', (event) => {
      if (event.payload.entity === 'comment' && event.payload.projectId === project.value) wake.ring();
    });
    const offCommand = events.on('command.changed', (event) => {
      if (event.payload.projectId === project.value) wake.ring();
    });
    const onAbort = () => wake.ring();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      let shown: string | undefined;
      while (!signal.aborted) {
        const next = await store.list(timelineId);
        if (!next.ok) throw next.error;
        const text = JSON.stringify(next.value);
        if (text !== shown) {
          shown = text;
          yield next.value;
        }
        await wake.wait();
      }
    } finally {
      offChanged();
      offCommand();
      signal.removeEventListener('abort', onAbort);
    }
  }

  return {
    list: ({ timelineId, statuses }) => store.list(timelineId, statuses ? { statuses } : {}),
    watch,
  };
}
