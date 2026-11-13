// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT1: commands dispatched with one group undo and redo together, as one step, and survive a restart. */
import { describe, expect, it } from 'vitest';
import {
  AGENT_TURN_GROUP_PREFIX,
  agentTurnGroup,
  commandsContract,
  commandsRouter,
  connectRpc,
  createCommandBus,
  createManualClock,
  ConflictError,
  defineError,
  err,
  newId,
  serveRpc,
  unwrap,
  type AuditLogStore,
  type CommandOrigin,
} from '@taalcut/core';
import { setupBus, UI } from './helpers/bus';
import { channel } from './helpers/ports';

const AGENT: CommandOrigin = { source: 'agent', actor: 'agent:run' };
const Offline = defineError('test.offline_group', { retryable: true });

async function renames(
  bus: ReturnType<typeof setupBus>['bus'],
  projectId: ReturnType<typeof setupBus>['projectId'],
  names: readonly string[],
  group?: string,
) {
  for (const name of names) {
    unwrap(await bus.dispatch('project.rename', { projectId, name }, AGENT, group ? { group } : {}));
  }
}

describe('command groups (EDT1)', () => {
  it('undoes a whole group in one step and redoes it in order', async () => {
    const { bus, projects, projectId, store } = setupBus();
    unwrap(await bus.dispatch('project.rename', { projectId, name: 'Mine' }, UI));
    await renames(bus, projectId, ['A', 'B', 'C'], 'turn:1');
    expect(store.entries().map((entry) => entry.group ?? null)).toEqual([null, 'turn:1', 'turn:1', 'turn:1']);
    expect(unwrap(await bus.history(projectId))).toEqual({
      undo: 'project.rename',
      redo: null,
      undoGroup: 'turn:1',
    });

    const undone = unwrap(await bus.undo(projectId, UI));
    expect(undone).toMatchObject({ group: 'turn:1', steps: 3, name: 'project.rename' });
    expect(undone?.id).toBe(store.entries()[3]!.id);
    expect(projects.nameOf(projectId)).toBe('Mine');
    expect(unwrap(await bus.history(projectId))).toEqual({
      undo: 'project.rename',
      redo: 'project.rename',
      redoGroup: 'turn:1',
    });

    const redone = unwrap(await bus.redo(projectId, UI));
    expect(redone).toMatchObject({ group: 'turn:1', steps: 3 });
    expect(redone?.id).toBe(store.entries()[1]!.id);
    expect(projects.nameOf(projectId)).toBe('C');

    // The next undo after the group is the person's own rename, alone.
    unwrap(await bus.undo(projectId, UI));
    const single = unwrap(await bus.undo(projectId, UI));
    expect(single).not.toHaveProperty('group');
    expect(projects.nameOf(projectId)).toBe('Untitled');
  });

  it('keeps two groups apart, and a command between them splits nothing', async () => {
    const { bus, projects, projectId } = setupBus();
    await renames(bus, projectId, ['A', 'B'], 'turn:1');
    await renames(bus, projectId, ['C'], 'turn:2');
    unwrap(await bus.undo(projectId, UI));
    expect(projects.nameOf(projectId)).toBe('B');
    unwrap(await bus.undo(projectId, UI));
    expect(projects.nameOf(projectId)).toBe('Untitled');
  });

  it("undoes only the group it is asked to, and conflicts when that isn't next", async () => {
    const { bus, projects, projectId } = setupBus();
    await renames(bus, projectId, ['A', 'B'], 'turn:1');
    unwrap(await bus.dispatch('project.rename', { projectId, name: 'Mine' }, UI));

    const refused = await bus.undo(projectId, UI, { group: 'turn:1' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(ConflictError.is(refused.error)).toBe(true);
    expect(projects.nameOf(projectId)).toBe('Mine');

    unwrap(await bus.undo(projectId, UI));
    expect(unwrap(await bus.undo(projectId, UI, { group: 'turn:1' }))).toMatchObject({ steps: 2 });
    expect(projects.nameOf(projectId)).toBe('Untitled');
    // Nothing left: asking for the group again is a conflict too, never a silent nothing.
    expect((await bus.undo(projectId, UI, { group: 'turn:1' })).ok).toBe(false);
  });

  it('rebuilds groups from the log after a restart', async () => {
    const { bus, store, projects, projectId, rename } = setupBus();
    await renames(bus, projectId, ['A', 'B'], 'turn:1');
    const restarted = createCommandBus({ store, clock: createManualClock(5_000) });
    restarted.register(rename);
    expect(unwrap(await restarted.history(projectId))).toMatchObject({ undoGroup: 'turn:1' });
    expect(unwrap(await restarted.undo(projectId, UI))).toMatchObject({ steps: 2 });
    expect(projects.nameOf(projectId)).toBe('Untitled');
  });

  it('stops a group at its first failure and goes on with the rest next time', async () => {
    let failNext = false;
    const wrap = (memory: AuditLogStore): AuditLogStore => ({
      ...memory,
      markUndone: async (change) => {
        if (failNext) {
          failNext = false;
          return err(Offline());
        }
        return memory.markUndone(change);
      },
    });
    const { bus, projects, projectId } = setupBus({ store: wrap });
    await renames(bus, projectId, ['A', 'B', 'C'], 'turn:1');
    failNext = true;
    const failed = await bus.undo(projectId, UI);
    expect(failed.ok).toBe(false);
    // The store refused the newest step's mark, so its rename was put back: nothing changed.
    expect(projects.nameOf(projectId)).toBe('C');
    expect(unwrap(await bus.undo(projectId, UI))).toMatchObject({ steps: 3 });
    expect(projects.nameOf(projectId)).toBe('Untitled');
  });

  it("gives an agent turn's group one shape, and the renderer undoes a group over IPC", async () => {
    const runId = newId<'AgentRun'>();
    expect(agentTurnGroup(runId)).toBe(`${AGENT_TURN_GROUP_PREFIX}${runId}`);
    const setup = setupBus();
    const { port1, port2 } = channel();
    serveRpc(commandsRouter(setup.bus), port1, { context: {} });
    const { client } = connectRpc(commandsContract, port2, { peer: 'agent' });
    await renames(setup.bus, setup.projectId, ['A', 'B'], agentTurnGroup(runId));
    expect(await client.history({ projectId: setup.projectId })).toEqual({
      undo: 'project.rename',
      redo: null,
      undoGroup: agentTurnGroup(runId),
    });
    expect(await client.undo({ projectId: setup.projectId, group: agentTurnGroup(runId) })).toMatchObject({
      group: agentTurnGroup(runId),
      steps: 2,
    });
    expect(setup.projects.nameOf(setup.projectId)).toBe('Untitled');
    await expect(client.undo({ projectId: setup.projectId, group: agentTurnGroup(runId) })).rejects.toThrow();
  });
});
