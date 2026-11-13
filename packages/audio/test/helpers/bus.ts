// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's real command bus over an in-memory TimelineStore, for audio's command tests. `timeline.restore` is the
 * timeline lane's handler; this test copy writes the parts back the same way, so undo and redo run end to end.
 */
import {
  ConflictError,
  createCommandBus,
  createCommitAnnouncer,
  createMemoryAuditLogStore,
  defineCommand,
  err,
  NotFoundError,
  ok,
  RationalTime,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  type AnyCommand,
  type AuditLogStore,
  type CommandBus,
  type CommandOrigin,
  type Timeline,
  type TimelineId,
  type TimelineStore,
  type TimelineSummary,
} from '@taalcut/core';
import type { TimelineWriteDeps } from '../../src/commands/timeline-writes';

export const UI: CommandOrigin = { source: 'ui', actor: 'user' };
export const AGENT: CommandOrigin = { source: 'agent', actor: 'agent:test' };
export const MCP: CommandOrigin = { source: 'mcp', actor: 'mcp:test' };

function summary(timeline: Timeline): TimelineSummary {
  return {
    id: timeline.id,
    projectId: timeline.projectId,
    name: timeline.name,
    revision: timeline.revision,
    duration: RationalTime.of(0, timeline.canvas.rate),
    clipCount: 0,
    template: timeline.template,
    castId: null,
    variantIndex: null,
    updatedAt: timeline.updatedAt,
  };
}

export function memoryTimelineStore(
  ...timelines: Timeline[]
): TimelineStore & { current(id: TimelineId): Timeline } {
  const docs = new Map<TimelineId, Timeline>(timelines.map((t) => [t.id, t]));
  const current = (id: TimelineId) => {
    const doc = docs.get(id);
    if (!doc) throw new Error(`no timeline ${id}`);
    return doc;
  };
  return {
    current,
    async create(timeline) {
      docs.set(timeline.id, timeline);
      return ok(summary(timeline));
    },
    async put(timeline, expectedRevision) {
      const stored = docs.get(timeline.id);
      if (!stored) return err(NotFoundError({ entity: 'timeline', id: timeline.id }));
      if (stored.revision !== expectedRevision)
        return err(ConflictError({ entity: 'timeline', id: timeline.id }));
      docs.set(timeline.id, timeline);
      return ok(summary(timeline));
    },
    async get(timelineId) {
      const doc = docs.get(timelineId);
      if (!doc) return err(NotFoundError({ entity: 'timeline', id: timelineId }));
      return ok({ summary: summary(doc), schemaVersion: doc.schemaVersion, json: structuredClone(doc) });
    },
    async listByProject() {
      return ok([...docs.values()].map(summary));
    },
    async remove(timelineId) {
      docs.delete(timelineId);
      return ok(undefined);
    },
  };
}

/** The test copy of `timeline.restore`: writes the given parts back, with itself (the parts now) as inverse. */
function restoreCommand(store: ReturnType<typeof memoryTimelineStore>) {
  return defineCommand({
    name: TIMELINE_COMMANDS.restore,
    payload: timelineCommandPayloads[TIMELINE_COMMANDS.restore],
    sideEffect: 'write',
    internal: true,
    handle: async (payload) => {
      const before = store.current(payload.timelineId);
      const { projectId, timelineId, ...parts } = payload;
      const next = { ...before, ...parts, revision: before.revision + 1 } as Timeline;
      const put = await store.put(next, before.revision);
      if (!put.ok) return put;
      const inverse = Object.fromEntries(Object.keys(parts).map((k) => [k, before[k as keyof Timeline]]));
      return ok({
        result: null,
        inverse: { name: TIMELINE_COMMANDS.restore, payload: { projectId, timelineId, ...inverse } },
      });
    },
  });
}

/** A bus over the timelines; give it another bus's `audit` log to stand for that bus after a restart. */
export function busWith(
  store: ReturnType<typeof memoryTimelineStore>,
  commands: (deps: TimelineWriteDeps) => readonly AnyCommand[],
  audit: AuditLogStore = createMemoryAuditLogStore(),
): { bus: CommandBus; deps: TimelineWriteDeps; changed: string[][]; audit: AuditLogStore } {
  const bus = createCommandBus({ store: audit, clock: { now: () => 1000 } });
  const announcer = createCommitAnnouncer();
  const deps: TimelineWriteDeps = { store, clock: { now: () => 1000 }, announcer };
  const changed: string[][] = [];
  announcer.attach(bus, {
    emit: (name, payload) => {
      if (name === 'library.changed' && 'ids' in payload) changed.push([...payload.ids]);
    },
  });
  bus.register(restoreCommand(store), ...commands(deps));
  return { bus, deps, changed, audit };
}
