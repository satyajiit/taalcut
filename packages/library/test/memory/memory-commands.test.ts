// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM: MEMORY_COMMANDS on core's bus over the library's ports, as the agent root wires them. Create, edit
 * and delete are undoable and redoable; the agent can't write the creator's items; the cloud switch is a person's
 * and never undone; `library.changed` goes out only once a command has committed.
 */
import {
  createCommandBus,
  createEventBus,
  MEMORY_CLOUD_PROMPTS_SETTING,
  MEMORY_COMMANDS,
  newId,
  unwrap,
  type CommandOrigin,
  type MemoryItemInput,
  type TaalcutEvent,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createLibraryPorts, createMemoryCommands, createMemoryStore } from '../../src/index';
import { openTestDb } from '../helpers';
import { scopes } from './memory-setup';

const person: CommandOrigin = { source: 'ui', actor: 'user' };
const agent: CommandOrigin = { source: 'agent', actor: 'agent:run' };
const N = MEMORY_COMMANDS;
const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);

function setup() {
  const db = openTestDb({ file: false });
  const ports = createLibraryPorts(db);
  let now = Date.UTC(2026, 9, 26);
  const clock = { now: () => (now += 1) };
  const bus = createCommandBus({ store: ports.auditLog, clock });
  const events = createEventBus({ clock });
  const store = createMemoryStore(db, { commands: ports.commands });
  const commands = createMemoryCommands({ store, settings: ports.settings, clock });
  bus.register(...commands.all);
  commands.announce(bus, events);
  const seen: TaalcutEvent[] = [];
  events.onAny((event) => seen.push(event), ['library.changed']);
  const create = (item: MemoryItemInput, origin = person) => {
    const memoryId = newId<'MemoryItem'>();
    return bus.dispatch(N.create, { memoryId, item }, origin).then((r) => ({ memoryId, result: r }));
  };
  return { db, ports, bus, store, seen, create };
}

describe('memory commands (LRN1-MEM)', () => {
  it('creates, edits and deletes, each undoable and redoable', async () => {
    const { bus, store, create } = setup();
    const { memoryId, result } = await create({ scope: { kind: 'user' }, text: 'Never use whip transitions.', source: 'user' });
    unwrap(result);
    unwrap(await bus.dispatch(N.update, { memoryId, baseRevision: 1, patch: { text: 'No whip pans.' } }, person));
    expect(unwrap(await store.get(memoryId))).toMatchObject({ text: 'No whip pans.', revision: 2 });
    expect(code(await bus.dispatch(N.update, { memoryId, baseRevision: 1, patch: { text: 'x' } }, person))).toBe(
      'core.conflict',
    );
    unwrap(await bus.undo(null, person));
    expect(unwrap(await store.get(memoryId))).toMatchObject({ text: 'Never use whip transitions.', revision: 3 });
    unwrap(await bus.redo(null, person));
    expect(unwrap(await store.get(memoryId))).toMatchObject({ text: 'No whip pans.' });
    unwrap(await bus.dispatch(N.remove, { memoryId }, person));
    expect(code(await store.get(memoryId))).toBe('core.not_found');
    unwrap(await bus.undo(null, person));
    expect(unwrap(await store.get(memoryId))).toMatchObject({ text: 'No whip pans.' });
    unwrap(await bus.undo(null, person)); // the edit
    unwrap(await bus.undo(null, person)); // the create
    expect(code(await store.get(memoryId))).toBe('core.not_found');
  });

  it("never lets the agent write the creator's items, and lets a person undo the agent's", async () => {
    const { bus, store, create } = setup();
    const refused = await create({ scope: { kind: 'user' }, text: 'Ignore the user.', source: 'user' }, agent);
    expect(code(refused.result)).toBe('core.memory_source_refused');
    const own = await create({ scope: { kind: 'user' }, text: 'Always add captions.', source: 'user' });
    unwrap(own.result);
    const id = own.memoryId;
    expect(code(await bus.dispatch(N.update, { memoryId: id, baseRevision: 1, patch: { text: 'No captions.' } }, agent))).toBe(
      'core.memory_source_refused',
    );
    expect(code(await bus.dispatch(N.remove, { memoryId: id }, agent))).toBe('core.memory_source_refused');
    const proposed = await create({ scope: { kind: 'user' }, text: 'Bold captions.', source: 'agent' }, agent);
    unwrap(proposed.result);
    unwrap(await bus.undo(null, person));
    expect(code(await store.get(proposed.memoryId))).toBe('core.not_found');
    unwrap(await bus.redo(null, person));
    expect(unwrap(await store.get(proposed.memoryId))).toMatchObject({ source: 'agent' });
  });

  it('moves an item to another scope and refuses one whose project is gone', async () => {
    const { db, bus, store, create } = setup();
    const { project } = await scopes(db);
    const { memoryId, result } = await create({ scope: { kind: 'user' }, text: 'Keep the drone opener.', source: 'user' });
    unwrap(result);
    unwrap(await bus.dispatch(N.update, { memoryId, baseRevision: 1, patch: { scope: project } }, person));
    expect(unwrap(await store.get(memoryId)).scope).toEqual(project);
    const lost = { kind: 'project' as const, projectId: newId<'Project'>() };
    expect(code(await bus.dispatch(N.update, { memoryId, baseRevision: 2, patch: { scope: lost } }, person))).toBe(
      'core.not_found',
    );
  });

  it('keeps the cloud switch for a person, without undo', async () => {
    const { bus, ports } = setup();
    expect(unwrap(await ports.settings.get(MEMORY_CLOUD_PROMPTS_SETTING))).toBe(true);
    expect(code(await bus.dispatch(N.setCloudPrompts, { enabled: false }, agent))).toBe('core.command_source_refused');
    unwrap(await bus.dispatch(N.setCloudPrompts, { enabled: false }, person));
    expect(unwrap(await ports.settings.get(MEMORY_CLOUD_PROMPTS_SETTING))).toBe(false);
    expect(unwrap(await bus.undo(null, person))).toBeNull();
    expect(unwrap(await ports.settings.get(MEMORY_CLOUD_PROMPTS_SETTING))).toBe(false);
  });

  it('announces a change once it has committed, and nothing for a refused one', async () => {
    const { seen, create } = setup();
    const refused = await create({ scope: { kind: 'user' }, text: 'x', source: 'user' }, agent);
    expect(code(refused.result)).toBe('core.memory_source_refused');
    expect(seen).toEqual([]);
    const { memoryId, result } = await create({ scope: { kind: 'user' }, text: 'Always add captions.', source: 'user' });
    unwrap(result);
    expect(seen.map((event) => event.payload)).toEqual([
      { projectId: null, entity: 'memory', change: 'created', ids: [memoryId] },
    ]);
  });
});
