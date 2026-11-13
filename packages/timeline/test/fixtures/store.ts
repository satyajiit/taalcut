// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** An in-memory TimelineStore with the optimistic revision check the library's has. */
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  RationalTime,
  type ProjectId,
  type Timeline,
  type TimelineStore,
  type TimelineSummary,
} from '@taalcut/core';
import { timelineStats } from '../../src/model/checks';

function summary(timeline: Timeline): TimelineSummary {
  const stats = timelineStats(timeline);
  return {
    id: timeline.id,
    projectId: timeline.projectId,
    name: timeline.name,
    revision: timeline.revision,
    duration: RationalTime.of(stats.frames, timeline.canvas.rate),
    clipCount: stats.clipCount,
    template: timeline.template,
    castId: timeline.cast?.castId ?? null,
    variantIndex: timeline.cast?.variantIndex ?? null,
    updatedAt: timeline.updatedAt,
  };
}

export interface MemoryTimelineStore extends TimelineStore {
  readonly docs: Map<string, Timeline>;
  /** Stored JSON with a schema version, as library would hand it back. */
  seed(json: unknown, schemaVersion: number, id: string): void;
}

export function createMemoryTimelineStore(): MemoryTimelineStore {
  const docs = new Map<string, Timeline>();
  const raw = new Map<string, { json: unknown; schemaVersion: number }>();
  // Stored as JSON, so a test never sees an object the handler still holds.
  const copy = (timeline: Timeline) => JSON.parse(JSON.stringify(timeline)) as Timeline;
  return {
    docs,
    seed(json, schemaVersion, id) {
      raw.set(id, { json, schemaVersion });
    },
    async create(timeline) {
      if (docs.has(timeline.id)) return err(ConflictError({ entity: 'timeline', id: timeline.id }));
      docs.set(timeline.id, copy(timeline));
      return ok(summary(timeline));
    },
    async put(timeline, expectedRevision) {
      const stored = docs.get(timeline.id);
      if (!stored) return err(NotFoundError({ entity: 'timeline', id: timeline.id }));
      if (stored.revision !== expectedRevision) return err(ConflictError({ entity: 'timeline', id: timeline.id }));
      docs.set(timeline.id, copy(timeline));
      return ok(summary(timeline));
    },
    async get(timelineId) {
      const seeded = raw.get(timelineId);
      if (seeded) {
        const { json, schemaVersion } = seeded;
        return ok({ summary: summary(json as Timeline), schemaVersion, json });
      }
      const stored = docs.get(timelineId);
      if (!stored) return err(NotFoundError({ entity: 'timeline', id: timelineId }));
      return ok({ summary: summary(stored), schemaVersion: 1, json: copy(stored) });
    },
    async listByProject(projectId: ProjectId) {
      return ok([...docs.values()].filter((timeline) => timeline.projectId === projectId).map(summary));
    },
    async remove(timelineId) {
      if (!docs.delete(timelineId)) return err(NotFoundError({ entity: 'timeline', id: timelineId }));
      return ok(undefined);
    },
  };
}
