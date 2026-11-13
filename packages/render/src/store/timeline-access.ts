// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TimelineAccess over core's TimelineStore (the library's): reads migrate and
 * validate the stored JSON with @taalcut/timeline, writes put revision + 1
 * against the revision read (core.conflict on a race), staged in the
 * command's unit of work when a context is given. With the library's saved
 * versions, a render reads exactly its revision even after later edits (the
 * `export` version render.export snapshots).
 */
import {
  err,
  NotFoundError,
  ok,
  type AsyncResult,
  type Result,
  type Timeline,
  type TimelineId,
  type TimelineStore,
  type TimelineVersionId,
} from '@taalcut/core';
import { migrateTimeline } from '@taalcut/timeline';
import type { TimelineAccess } from '../ports';

/** The part of the library's TimelineVersions render reads. */
export interface TimelineRevisions {
  list(
    timelineId: TimelineId,
    page?: { readonly limit?: number; readonly cursor?: string },
  ): Result<{
    items: readonly { readonly id: TimelineVersionId; readonly revision: number }[];
    nextCursor?: string;
  }>;
  get(id: TimelineVersionId): Result<{ readonly schemaVersion: number; readonly json: unknown }>;
}

export function timelineAccessOverStore(
  store: TimelineStore,
  options: { readonly now?: () => number; readonly versions?: TimelineRevisions } = {},
): TimelineAccess {
  const now = options.now ?? Date.now;
  const read = async (timelineId: TimelineId): AsyncResult<Timeline> => {
    const stored = await store.get(timelineId);
    if (!stored.ok) return stored;
    return migrateTimeline(stored.value.json, stored.value.schemaVersion);
  };
  const versions = options.versions;
  return {
    get: read,
    async update(timelineId, mutate, context) {
      const current = await read(timelineId);
      if (!current.ok) return current;
      const next: Timeline = {
        ...mutate(current.value),
        revision: current.value.revision + 1,
        updatedAt: now(),
      };
      const put = await store.put(next, current.value.revision, context);
      return put.ok ? ok(next) : put;
    },
    ...(versions
      ? {
          async atRevision(timelineId: TimelineId, revision: number): AsyncResult<Timeline> {
            let cursor: string | undefined;
            do {
              const page = versions.list(timelineId, { limit: 200, ...(cursor ? { cursor } : {}) });
              if (!page.ok) return page;
              const found = page.value.items.find((item) => item.revision === revision);
              if (found) {
                const version = versions.get(found.id);
                if (!version.ok) return version;
                return migrateTimeline(version.value.json, version.value.schemaVersion);
              }
              cursor = page.value.nextCursor;
            } while (cursor);
            return err(NotFoundError({ entity: 'timeline_revision', id: `${timelineId}@${revision}` }));
          },
        }
      : {}),
  };
}

/** Until a TimelineStore is registered in this process: every read says the timeline isn't there. */
export const timelinesUnavailable: TimelineAccess = {
  get: async (timelineId) => err(NotFoundError({ entity: 'timeline', id: timelineId })),
  update: async (timelineId) => err(NotFoundError({ entity: 'timeline', id: timelineId })),
};
