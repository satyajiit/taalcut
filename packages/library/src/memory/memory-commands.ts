// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MEMORY_COMMANDS (LRN1-MEM) on core's bus. App-wide. Create's inverse is delete; update and delete restore the
 * previous item; the cloud switch is person-only and never undone. Every write passes the command's context, so
 * it commits with the audit row or not at all, and `library.changed` (entity 'memory') goes out once it has.
 *
 * Who may write what (core's memory-commands.ts): anyone but a person (the agent, an MCP client) may not create
 * a `user` item, nor change or delete one, so nothing a model reads can make itself the creator's instruction. A
 * person may do anything, which keeps undo and redo of the agent's items working.
 */
import {
  ConflictError,
  createCommitAnnouncer,
  defineCommand,
  err,
  MEMORY_CLOUD_PROMPTS_SETTING,
  MEMORY_COMMANDS,
  memoryCommandPayloads,
  MemorySourceRefused,
  ok,
  PERSON_SOURCES,
  type AnyCommand,
  type Clock,
  type CommandContext,
  type CommitAnnouncer,
  type MemoryId,
  type MemoryItem,
  type MemoryStore,
  type Result,
  type SettingsStore,
} from '@taalcut/core';

const N = MEMORY_COMMANDS;
const P = memoryCommandPayloads;
const APP_WIDE = { projectId: null };

export interface MemoryCommandDeps {
  readonly store: MemoryStore;
  readonly settings: SettingsStore;
  readonly clock: Clock;
}

const isPerson = (context: CommandContext) =>
  (PERSON_SOURCES as readonly string[]).includes(context.source);

/** A `user` item is the creator's: only a person writes one. */
function mayWrite(context: CommandContext, item: Pick<MemoryItem, 'source'>): Result<void> {
  return item.source === 'user' && !isPerson(context)
    ? err(MemorySourceRefused({ source: item.source }))
    : ok(undefined);
}

export function createMemoryCommands({ store, settings, clock }: MemoryCommandDeps) {
  const announcer: CommitAnnouncer = createCommitAnnouncer();
  const changed = (context: CommandContext, change: 'created' | 'updated' | 'deleted', id: MemoryId) =>
    announcer.note(context, { projectId: null, entity: 'memory', change, ids: [id] });

  const create = defineCommand({
    name: N.create,
    payload: P[N.create],
    sideEffect: 'write',
    handle: async ({ memoryId, item }, context) => {
      const allowed = mayWrite(context, item);
      if (!allowed.ok) return allowed;
      const now = clock.now();
      const stored = await store.create(
        { id: memoryId, ...item, revision: 1, createdAt: now, updatedAt: now },
        context,
      );
      if (!stored.ok) return stored;
      changed(context, 'created', memoryId);
      return ok({
        result: { memoryId, revision: 1 },
        inverse: { name: N.remove, payload: { ...APP_WIDE, memoryId } },
      });
    },
  });

  const update = defineCommand({
    name: N.update,
    payload: P[N.update],
    sideEffect: 'write',
    handle: async ({ memoryId, baseRevision, patch }, context) => {
      const current = await store.get(memoryId);
      if (!current.ok) return current;
      const allowed = mayWrite(context, current.value);
      if (!allowed.ok) return allowed;
      // A redo runs the payload again on purpose: undo moved the revision on since it first ran.
      if (context.replay !== 'redo' && current.value.revision !== baseRevision)
        return err(ConflictError({ entity: 'memory', id: memoryId }));
      const next: MemoryItem = {
        ...current.value,
        ...patch,
        revision: current.value.revision + 1,
        updatedAt: clock.now(),
      };
      const stored = await store.put(next, current.value.revision, context);
      if (!stored.ok) return stored;
      changed(context, 'updated', memoryId);
      return ok({
        result: { memoryId, revision: next.revision },
        inverse: { name: N.restore, payload: { ...APP_WIDE, memoryId, item: current.value } },
      });
    },
  });

  const remove = defineCommand({
    name: N.remove,
    payload: P[N.remove],
    sideEffect: 'write',
    handle: async ({ memoryId }, context) => {
      const current = await store.get(memoryId);
      if (!current.ok) return current;
      const allowed = mayWrite(context, current.value);
      if (!allowed.ok) return allowed;
      const removed = await store.remove(memoryId, context);
      if (!removed.ok) return removed;
      changed(context, 'deleted', memoryId);
      return ok({
        result: { memoryId },
        inverse: { name: N.restore, payload: { ...APP_WIDE, memoryId, item: current.value } },
      });
    },
  });

  /** Puts the item back as it was; its revision still moves on, so an edit made on the undone one conflicts. */
  const restore = defineCommand({
    name: N.restore,
    payload: P[N.restore],
    sideEffect: 'write',
    internal: true,
    handle: async ({ memoryId, item }, context) => {
      const current = await store.get(memoryId);
      if (!current.ok && current.error.code !== 'core.not_found') return current;
      if (item === null) {
        if (!current.ok) return ok({ result: { memoryId } });
        const removed = await store.remove(memoryId, context);
        if (!removed.ok) return removed;
        changed(context, 'deleted', memoryId);
        return ok({ result: { memoryId } });
      }
      if (item.id !== memoryId) return err(ConflictError({ entity: 'memory', id: memoryId }));
      const stored = current.ok
        ? await store.put({ ...item, revision: current.value.revision + 1 }, current.value.revision, context)
        : await store.create(item, context);
      if (!stored.ok) return stored;
      changed(context, current.ok ? 'updated' : 'created', memoryId);
      return ok({ result: { memoryId, revision: stored.value.revision } });
    },
  });

  const setCloudPrompts = defineCommand({
    name: N.setCloudPrompts,
    payload: P[N.setCloudPrompts],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    handle: async ({ enabled }, context) => {
      const saved = await settings.set(MEMORY_CLOUD_PROMPTS_SETTING, enabled, context);
      return saved.ok ? ok({ result: { enabled } }) : saved;
    },
  });

  const all: AnyCommand[] = [create, update, remove, restore, setCloudPrompts];
  return {
    create,
    update,
    remove,
    restore,
    setCloudPrompts,
    /** Every memory command, for `bus.register(...all)`. */
    all,
    /** Sends `library.changed` for each committed memory command (call once with the agent's bus). */
    announce: (
      bus: Parameters<CommitAnnouncer['attach']>[0],
      events: Parameters<CommitAnnouncer['attach']>[1],
    ) => announcer.attach(bus, events),
  };
}

export type MemoryCommands = ReturnType<typeof createMemoryCommands>;
