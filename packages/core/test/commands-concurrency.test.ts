// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Review 2: races and failures the per-project queue alone didn't cover. A key
 * shared by two projects, history() racing a dispatch, a restart after many
 * commands without an inverse, and an undo whose rollback failed.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CommandRollbackFailed,
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  defineCommand,
  defineError,
  err,
  idSchema,
  ok,
  unwrap,
  type AuditLogStore,
} from '@taalcut/core';
import { deferred, setupBus, UI } from './helpers/bus';
import { createProjectRenameCommand } from './helpers/projects';

const AGENT = { source: 'agent', actor: 'agent:run-1' } as const;
const Offline = defineError('test.offline', { retryable: true });

/** An external command with no inverse that counts how often it ran. */
function publishCommand() {
  const runs: string[] = [];
  const command = defineCommand({
    name: 'project.publish',
    payload: z.object({ projectId: idSchema<'Project'>(), caption: z.string() }),
    sideEffect: 'external',
    handle: async ({ caption }) => {
      runs.push(caption);
      await Promise.resolve();
      return ok({ result: caption });
    },
  });
  return { command, runs };
}

describe('command bus: one key, one run', () => {
  it('runs a key once when two projects dispatch it at the same time', async () => {
    const { bus, store, projects } = setupBus({ names: ['A', 'B'] });
    const { command, runs } = publishCommand();
    bus.register(command);
    const key = 'agent:run-1:project.publish';
    const [left, right] = await Promise.all([
      bus.dispatch(command, { projectId: projects.ids[0]!, caption: 'publish-A' }, AGENT, {
        idempotencyKey: key,
      }),
      bus.dispatch(command, { projectId: projects.ids[1]!, caption: 'publish-B' }, AGENT, {
        idempotencyKey: key,
      }),
    ]);
    expect(runs).toEqual(['publish-A']);
    expect(store.entries()).toHaveLength(1);
    expect(unwrap(left).deduplicated).toBe(false);
    expect(unwrap(right)).toEqual({ ...unwrap(left), deduplicated: true });
  });

  it('refuses a second entry with the same key in the store', async () => {
    const store = createMemoryAuditLogStore();
    const entry = {
      id: 'id' as never,
      projectId: null,
      name: 'x.y',
      payload: {},
      inverse: null,
      source: 'ui' as const,
      actor: 'user',
      sideEffect: 'write' as const,
      createdAt: 0,
      idempotencyKey: 'k',
      result: null,
    };
    unwrap(await store.append(entry));
    const again = await store.append({ ...entry, id: 'other' as never });
    expect(!again.ok && again.error.code).toBe('core.conflict');
    expect(store.entries()).toHaveLength(1);
  });

  it('replays, after rolling back, when another bus on the same store committed the key first', async () => {
    let value = 0;
    const add = defineCommand({
      name: 'counter.add',
      payload: z.object({ delta: z.number() }),
      sideEffect: 'write',
      handle: async ({ delta }) => {
        value += delta;
        return ok({ result: delta, inverse: { name: 'counter.add', payload: { delta: -delta } } });
      },
    });
    const store = createMemoryAuditLogStore();
    const held = deferred();
    // This bus checks the key and runs the handler, then waits before appending.
    const slowStore: AuditLogStore = {
      ...store,
      append: async (entry) => {
        await held.promise;
        return store.append(entry);
      },
    };
    const slow = createCommandBus({ store: slowStore, clock: createManualClock() });
    const other = createCommandBus({ store, clock: createManualClock() });
    slow.register(add);
    other.register(add);
    const key = 'k-shared';
    const late = slow.dispatch(add, { delta: 1 }, AGENT, { idempotencyKey: key });
    await Promise.resolve();
    const first = unwrap(await other.dispatch(add, { delta: 1 }, AGENT, { idempotencyKey: key }));
    held.resolve();
    expect(unwrap(await late)).toEqual({ ...first, deduplicated: true });
    expect(value).toBe(1); // the late run was rolled back
    expect(store.entries()).toHaveLength(1);
  });
});

describe('command bus: history and undo', () => {
  it('keeps the live stack when history() reads the log while a command runs', async () => {
    const gate = deferred();
    let reads = 0;
    const { bus, projects, projectId } = setupBus({
      store: (memory) => ({
        ...memory,
        listByProject: async (...args) => {
          reads += 1;
          await gate.promise;
          return memory.listByProject(...args);
        },
      }),
    });
    const shown = bus.history(projectId);
    const renamed = bus.dispatch('project.rename', { projectId, name: 'Trip' }, UI);
    await Promise.resolve();
    gate.resolve();
    unwrap(await renamed);
    expect(unwrap(await shown)).toEqual({ undo: null, redo: null }); // read before the rename
    expect(unwrap(await bus.history(projectId))).toEqual({ undo: 'project.rename', redo: null });
    expect(unwrap(await bus.undo(projectId, UI))).toMatchObject({ name: 'project.rename' });
    expect(projects.nameOf(projectId)).toBe('Untitled');
    expect(reads).toBe(1);
  });

  it('still offers an undo after a restart, however many commands without an inverse followed it', async () => {
    const { bus, store, projects, projectId } = setupBus();
    const { command } = publishCommand();
    bus.register(command);
    unwrap(await bus.dispatch('project.rename', { projectId, name: 'Trip' }, UI));
    for (let i = 0; i < 5; i++) unwrap(await bus.dispatch(command, { projectId, caption: `post ${i}` }, UI));
    const restarted = createCommandBus({ store, clock: createManualClock(), maxHistory: 1 });
    restarted.register(createProjectRenameCommand({ projects: projects.repository }), command);
    expect(unwrap(await restarted.history(projectId)).undo).toBe('project.rename');
    unwrap(await restarted.undo(projectId, UI));
    expect(projects.nameOf(projectId)).toBe('Untitled');
  });

  it('freezes undo and redo for a project after a rollback fails, so an inverse is not applied twice', async () => {
    let value = 0;
    let offline = false;
    const add = defineCommand({
      name: 'counter.add',
      payload: z.object({ delta: z.number() }),
      sideEffect: 'write',
      handle: async ({ delta }) => {
        if (offline && delta > 0) return err(Offline());
        value += delta;
        return ok({ result: value, inverse: { name: 'counter.add', payload: { delta: -delta } } });
      },
    });
    const { bus } = setupBus({
      store: (memory) => ({ ...memory, markUndone: async () => (offline ? err(Offline()) : ok(undefined)) }),
    });
    bus.register(add);
    unwrap(await bus.dispatch(add, { delta: 1 }, UI));
    unwrap(await bus.dispatch(add, { delta: 1 }, UI));
    offline = true;
    const failed = await bus.undo(null, UI);
    expect(!failed.ok && CommandRollbackFailed.is(failed.error)).toBe(true);
    expect(value).toBe(1); // the inverse ran and the compensation didn't
    const again = await bus.undo(null, UI);
    expect(!again.ok && CommandRollbackFailed.is(again.error)).toBe(true);
    expect((await bus.redo(null, UI)).ok).toBe(false);
    expect(value).toBe(1);
    expect(unwrap(await bus.history(null))).toEqual({ undo: null, redo: null });
    offline = false;
    unwrap(await bus.dispatch(add, { delta: -1 }, UI)); // new commands still run
    expect(value).toBe(0);
  });
});
