// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's real command bus over a timeline store that stages writes the way the library's unit of work does:
 * a write made with a command's context is applied only when the bus records that step (append, markUndone,
 * markRedone), so a handler that fails part-way leaves nothing behind. What the Phase 3 command tests run on.
 */
import {
  createCommandBus,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  forwardCommandEvents,
  ok,
  type AuditLogStore,
  type CommandContext,
  type CommandId,
  type CommandOrigin,
  type Result,
  type Timeline,
  type TimelineStore,
} from '@taalcut/core';
import { createTimelineCommands } from '../../src/commands/commands';
import type { TimelineCommandDeps } from '../../src/commands/context';
import { createMemoryTimelineStore, type MemoryTimelineStore } from './store';

export const ui: CommandOrigin = { source: 'ui', actor: 'user' };
export const agentOrigin: CommandOrigin = { source: 'agent', actor: 'agent:run' };

type Write = () => Promise<Result<unknown>>;

/** Staged writes per command id, applied when the bus records the step. */
function stager() {
  const pending = new Map<CommandId, Write[]>();
  return {
    stage(context: CommandContext, write: Write) {
      const writes = pending.get(context.commandId) ?? [];
      writes.push(write);
      pending.set(context.commandId, writes);
    },
    async flush(id: CommandId) {
      const writes = pending.get(id) ?? [];
      pending.delete(id);
      for (const write of writes) {
        const done = await write();
        if (!done.ok) return done;
      }
      return ok(undefined);
    },
    drop(id: CommandId) {
      pending.delete(id);
    },
  };
}

function stagingAudit(base: AuditLogStore, staged: ReturnType<typeof stager>): AuditLogStore {
  /** The recorded step, once the command's staged writes landed; the first failed write otherwise. */
  async function landed<T>(step: Result<T>, id: CommandId): Promise<Result<T>> {
    if (!step.ok) return step;
    const flushed = await staged.flush(id);
    return flushed.ok ? step : flushed;
  }
  return {
    ...base,
    async append(entry) {
      const appended = await base.append(entry);
      if (!appended.ok) staged.drop(entry.id);
      return landed(appended, entry.id);
    },
    markUndone: async (change) => landed(await base.markUndone(change), change.id),
    markRedone: async (change) => landed(await base.markRedone(change), change.id),
  };
}

/** Checks now (as the library does), writes when the step is recorded. */
function stagingStore(base: MemoryTimelineStore, staged: ReturnType<typeof stager>): TimelineStore {
  return {
    ...base,
    async create(timeline, context) {
      if (!context) return base.create(timeline);
      const existing = await base.get(timeline.id);
      if (existing.ok) return base.create(timeline);
      staged.stage(context, () => base.create(timeline));
      return ok({
        id: timeline.id,
        projectId: timeline.projectId,
        name: timeline.name,
        revision: timeline.revision,
        duration: { value: 0, rate: timeline.canvas.rate },
        clipCount: 0,
        template: timeline.template,
        castId: timeline.cast?.castId ?? null,
        variantIndex: timeline.cast?.variantIndex ?? null,
        updatedAt: timeline.updatedAt,
      });
    },
    async put(timeline, expectedRevision, context) {
      if (!context) return base.put(timeline, expectedRevision);
      const stored = await base.get(timeline.id);
      if (!stored.ok) return stored;
      if (stored.value.summary.revision !== expectedRevision) return base.put(timeline, expectedRevision);
      staged.stage(context, () => base.put(timeline, expectedRevision));
      return ok(stored.value.summary);
    },
    async remove(timelineId, context) {
      if (!context) return base.remove(timelineId);
      staged.stage(context, () => base.remove(timelineId));
      return ok(undefined);
    },
  };
}

/** What survives a restart: the audit log and the stored documents. */
export interface WorldDisk {
  readonly audit: AuditLogStore;
  readonly memory: MemoryTimelineStore;
}

/** A world over `restartOn` when given (the app restarted on the same data), else over a new one. */
export function commandWorld(extra: Partial<TimelineCommandDeps> = {}, restartOn?: WorldDisk) {
  const clock = createManualClock(1_000);
  const staged = stager();
  const audit = restartOn?.audit ?? createMemoryAuditLogStore();
  const bus = createCommandBus({ store: stagingAudit(audit, staged), clock });
  const events = createEventBus({ clock });
  forwardCommandEvents(bus, events);
  const memory = restartOn?.memory ?? createMemoryTimelineStore();
  const store = stagingStore(memory, staged);
  const commands = createTimelineCommands({ store, events, clock, ...extra });
  bus.register(...commands.all);
  commands.announce(bus);

  async function dispatch(name: string, payload: unknown, origin: CommandOrigin = ui) {
    const receipt = await bus.dispatch(name, payload, origin);
    return receipt.ok ? ok(receipt.value.result) : receipt;
  }

  /** The stored document (what a reader would get). */
  function doc(timelineId: string): Timeline {
    const found = memory.docs.get(timelineId);
    if (!found) throw new Error(`No timeline ${timelineId}`);
    return found;
  }

  async function seed(...timelines: Timeline[]) {
    for (const timeline of timelines) await memory.create(timeline);
  }

  const disk: WorldDisk = { audit, memory };
  return { bus, clock, events, store, memory, disk, commands, dispatch, doc, seed };
}
