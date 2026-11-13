// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Command bus tests (P1-C4), driven by the demo `project.rename` command. */
import { describe, expect, it } from 'vitest';
import { defineError, err, newId, unwrap, type AuditEntry } from '@taalcut/core';
import { deferred, setupBus, UI } from './helpers/bus';
import { createRenameProjectTool } from './helpers/projects';
import { tick } from './helpers/ports';

const StorageFull = defineError('test.storage_full', { retryable: true });

/** Everything except who dispatched it, ids, timestamps and log position. */
const comparable = ({ id: _id, source: _s, actor: _a, createdAt: _c, sequence: _q, ...rest }: AuditEntry) =>
  rest;

describe('command bus: one code path for every source', () => {
  it('logs identical entries for project.rename from the UI and from an agent tool, and both undo and redo', async () => {
    const { bus, store, clock, projects, rename, projectId } = setupBus();

    const fromUi = unwrap(await bus.dispatch(rename, { projectId, name: '  Trip to Goa ' }, UI));
    expect(fromUi).toMatchObject({ name: 'project.rename', sequence: 1, undoable: true });
    expect(fromUi.result).toEqual({ projectId, name: 'Trip to Goa' });
    const uiEntry = store.entries()[0]!;
    expect(unwrap(await bus.undo(projectId, UI))).toEqual({
      id: fromUi.id,
      name: 'project.rename',
      projectId,
      // What the inverse returned (round P3-3).
      result: { projectId, name: 'Untitled' },
    });
    expect(projects.nameOf(projectId)).toBe('Untitled');
    unwrap(await bus.redo(projectId, UI));
    expect(projects.nameOf(projectId)).toBe('Trip to Goa');
    unwrap(await bus.undo(projectId, { source: 'shortcut', actor: 'user' }));
    expect(projects.nameOf(projectId)).toBe('Untitled');

    clock.advance(60_000);
    const runId = newId<'AgentRun'>();
    const fromAgent = unwrap(
      await createRenameProjectTool(bus).run({ projectId, name: 'Trip to Goa' }, runId),
    );
    const agentEntry = store.entries()[1]!;
    expect(comparable(agentEntry)).toEqual(comparable(uiEntry));
    expect(uiEntry).toMatchObject({ source: 'ui', actor: 'user', createdAt: 1_000 });
    expect(agentEntry).toMatchObject({ source: 'agent', actor: `agent:${runId}`, createdAt: 61_000 });
    expect(agentEntry.inverse).toEqual({ name: 'project.rename', payload: { projectId, name: 'Untitled' } });

    unwrap(await bus.undo(projectId, { source: 'agent', actor: `agent:${runId}` }));
    expect(projects.nameOf(projectId)).toBe('Untitled');
    unwrap(await bus.redo(projectId, UI));
    expect(projects.nameOf(projectId)).toBe('Trip to Goa');
    expect(store.entries().map((entry) => [entry.id, entry.undone])).toEqual([
      [fromUi.id, true],
      [fromAgent.id, false],
    ]);
  });
});

describe('command bus: commit before acknowledge', () => {
  it('resolves dispatch only after the store has persisted the entry', async () => {
    const gate = deferred();
    const { bus, store, projects, projectId } = setupBus({
      store: (memory) => ({
        ...memory,
        append: async (entry) => {
          await gate.promise;
          return memory.append(entry);
        },
      }),
    });
    let acknowledged = false;
    const pending = bus.dispatch('project.rename', { projectId, name: 'Trip' }, UI).then((result) => {
      acknowledged = true;
      return result;
    });
    await tick(10);
    expect(projects.nameOf(projectId)).toBe('Trip');
    expect(acknowledged).toBe(false);
    expect(store.entries()).toHaveLength(0);
    gate.resolve();
    expect(unwrap(await pending).sequence).toBe(1);
    expect(store.entries()).toHaveLength(1);
  });

  it('puts the state back and reports the store error when the entry cannot be persisted', async () => {
    const { bus, projects, projectId } = setupBus({
      store: (memory) => ({ ...memory, append: async () => err(StorageFull()) }),
    });
    const result = await bus.dispatch('project.rename', { projectId, name: 'Trip' }, UI);
    expect(!result.ok && result.error.code).toBe('test.storage_full');
    expect(projects.nameOf(projectId)).toBe('Untitled');
    expect(unwrap(await bus.history(projectId))).toEqual({ undo: null, redo: null });
  });

  it('says so when putting the state back fails too', async () => {
    const { bus, projects, projectId } = setupBus({
      store: (memory) => ({ ...memory, append: async () => err(StorageFull()) }),
    });
    const rename = projects.repository.rename;
    let calls = 0;
    projects.repository.rename = async (id, name) => (++calls > 1 ? err(StorageFull()) : rename(id, name));
    const result = await bus.dispatch('project.rename', { projectId, name: 'Trip' }, UI);
    expect(!result.ok && result.error.code).toBe('core.command_rollback_failed');
    expect(!result.ok && result.error.detail).toBe('test.storage_full; rollback: test.storage_full');
  });
});

describe('command bus: validation and failures', () => {
  it('validates every payload with the command schema', async () => {
    const { bus, store, projectId } = setupBus();
    const empty = await bus.dispatch('project.rename', { projectId, name: '   ' }, UI);
    expect(!empty.ok && empty.error).toMatchObject({ code: 'core.validation', params: { field: 'name' } });
    const badId = await bus.dispatch('project.rename', { projectId: 'nope', name: 'x' }, UI);
    expect(!badId.ok && badId.error.params).toEqual({ field: 'projectId' });
    const noPayload = await bus.dispatch('project.rename', undefined, UI);
    expect(!noPayload.ok && noPayload.error.code).toBe('core.validation');
    expect(store.entries()).toHaveLength(0);
  });

  it('rejects unknown commands and logs nothing when a handler fails or throws', async () => {
    const { bus, store, projects } = setupBus();
    const unknown = await bus.dispatch('project.explode', {}, UI);
    expect(!unknown.ok && unknown.error.params).toEqual({ entity: 'command', id: 'project.explode' });
    const missing = await bus.dispatch('project.rename', { projectId: newId<'Project'>(), name: 'x' }, UI);
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
    projects.repository.get = () => {
      throw new Error('disk on fire');
    };
    const thrown = await bus.dispatch('project.rename', { projectId: projects.ids[0], name: 'x' }, UI);
    expect(!thrown.ok && thrown.error).toMatchObject({ code: 'core.unknown', detail: 'Error' });
    expect(store.entries()).toHaveLength(0);
  });
});

describe('command bus: per-project history', () => {
  it('keeps one undo and redo stack per project; a new command clears redo', async () => {
    const { bus, projects } = setupBus({ names: ['A', 'B'] });
    const [a, b] = projects.ids as [(typeof projects.ids)[0], (typeof projects.ids)[0]];
    unwrap(await bus.dispatch('project.rename', { projectId: a, name: 'A1' }, UI));
    unwrap(await bus.dispatch('project.rename', { projectId: a, name: 'A2' }, UI));
    unwrap(await bus.dispatch('project.rename', { projectId: b, name: 'B1' }, UI));

    unwrap(await bus.undo(b, UI));
    expect([projects.nameOf(a), projects.nameOf(b)]).toEqual(['A2', 'B']);
    expect(unwrap(await bus.undo(b, UI))).toBeNull();
    expect(unwrap(await bus.history(b))).toEqual({ undo: null, redo: 'project.rename' });

    unwrap(await bus.undo(a, UI));
    expect(projects.nameOf(a)).toBe('A1');
    expect(unwrap(await bus.history(a))).toEqual({ undo: 'project.rename', redo: 'project.rename' });
    unwrap(await bus.dispatch('project.rename', { projectId: a, name: 'A3' }, UI));
    expect(unwrap(await bus.redo(a, UI))).toBeNull();
    unwrap(await bus.undo(a, UI));
    unwrap(await bus.undo(a, UI));
    expect(projects.nameOf(a)).toBe('A');
  });

  it('runs one project’s commands one at a time, in dispatch order', async () => {
    const { bus, projects, projectId } = setupBus();
    const receipts = await Promise.all(
      Array.from({ length: 20 }, (_, i) => bus.dispatch('project.rename', { projectId, name: `v${i}` }, UI)),
    );
    expect(receipts.map((receipt) => unwrap(receipt).sequence)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect(projects.nameOf(projectId)).toBe('v19');
    for (let i = 0; i < 20; i++) unwrap(await bus.undo(projectId, UI));
    expect(projects.nameOf(projectId)).toBe('Untitled');
  });
});
