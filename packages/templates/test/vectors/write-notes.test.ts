// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The write hook: every template write noted once its command commits, and the index following the notes. */
import {
  createCommandBus,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  err,
  newId,
  ok,
  TEMPLATE_COMMANDS as N,
  ValidationError,
  type CommandContext,
  type CommandId,
  type CommandListener,
  type EventPayload,
  type Result,
  type TaalcutError,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createTemplateCommands,
  createTemplateService,
  createTemplateWriteNotes,
  followTemplateWrites,
  notedTemplateStore,
  NO_SYNC,
  type TemplateVectors,
  type TemplateVectorSync,
} from '../../src/index';
import { createMemoryTemplateStore } from '../../src/test-support';
import { referenceTemplate, T0 } from '../helpers/fixtures';
import { unwrap } from '../helpers/result';
import { UI } from '../helpers/setup';
import { nth } from './helpers';

type Changed = EventPayload<'library.changed'>;

function setupNoted() {
  const clock = createManualClock(T0);
  const events = createEventBus({ clock });
  const notes = createTemplateWriteNotes(events);
  const store = notedTemplateStore(createMemoryTemplateStore(clock), notes);
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  bus.register(...createTemplateCommands({ service: createTemplateService({ store, clock }), store }).all);
  notes.attach(bus);
  const seen: Changed[] = [];
  events.on('library.changed', ({ payload }) => seen.push(payload));
  const projectId = newId<'Project'>();
  return { clock, events, notes, store, bus, seen, projectId };
}

describe('template write notes', () => {
  it('announces a create, an edit and its undo, each once its command committed', async () => {
    const { bus, seen, projectId } = setupNoted();
    const template = referenceTemplate();
    unwrap(await bus.dispatch(N.create, { projectId, template, name: 'Goa', listed: true }, UI));
    const rename = {
      projectId,
      templateId: template.id,
      baseVersion: 1,
      slotId: nth(template.slots, 0).id,
      name: 'A',
    };
    unwrap(await bus.dispatch(N.renameSlot, rename, UI));
    unwrap(await bus.undo(projectId, UI));
    expect(seen.map((change) => [change.entity, change.change, change.ids, change.projectId])).toEqual([
      ['template', 'created', [template.id], projectId],
      ['template', 'updated', [template.id], projectId],
      ['template', 'updated', [template.id], projectId],
    ]);
  });

  it('announces nothing for a command that failed', async () => {
    const { bus, seen, projectId } = setupNoted();
    const template = referenceTemplate();
    unwrap(await bus.dispatch(N.create, { projectId, template, name: 'Goa', listed: true }, UI));
    seen.length = 0;
    const stale = {
      projectId,
      templateId: template.id,
      baseVersion: 7,
      slotId: nth(template.slots, 0).id,
      name: 'A',
    };
    expect((await bus.dispatch(N.renameSlot, stale, UI)).ok).toBe(false);
    expect(seen).toEqual([]);
  });

  it('holds a staged write until its command commits, and drops it if it never does', async () => {
    const clock = createManualClock(T0);
    const events = createEventBus({ clock });
    const notes = createTemplateWriteNotes(events);
    const store = notedTemplateStore(createMemoryTemplateStore(clock), notes);
    const listeners: CommandListener[] = [];
    notes.attach({ subscribe: (listener) => (listeners.push(listener), () => undefined) });
    const seen: Changed[] = [];
    events.on('library.changed', ({ payload }) => seen.push(payload));
    const context: CommandContext = { ...UI, commandId: newId<'Command'>() as CommandId, projectId: null };
    const template = referenceTemplate();
    unwrap(await store.create(template, { name: 'Goa', projectId: null, listed: true }, context));
    expect(seen).toEqual([]);
    for (const listener of listeners)
      listener({ kind: 'executed', id: context.commandId, name: N.create, projectId: null, origin: UI });
    expect(seen.map((change) => change.change)).toEqual(['created']);
  });

  it('announces a write without a command at once, and a delete as deleted', async () => {
    const { store, seen } = setupNoted();
    const template = referenceTemplate();
    unwrap(await store.create(template, { name: 'Goa', projectId: null, listed: true }));
    unwrap(await store.setMeta(template.id, { tags: ['travel'] }));
    unwrap(await store.remove(template.id));
    expect(seen.map((change) => change.change)).toEqual(['created', 'updated', 'deleted']);
    expect((await store.remove(template.id)).ok).toBe(false);
    expect(seen).toHaveLength(3);
  });
});

describe('followTemplateWrites', () => {
  function fakeVectors(
    result: Result<TemplateVectorSync> = ok(NO_SYNC),
  ): TemplateVectors & { synced: string[][] } {
    const synced: string[][] = [];
    return {
      synced,
      dimensions: 4,
      sync: async (ids) => (synced.push([...ids]), result),
      reconcile: async () => ok(NO_SYNC),
      get: () => ok(new Map()),
    };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("syncs the templates each template change names, and ignores other entities' changes", async () => {
    const { events } = setupNoted();
    const vectors = fakeVectors();
    followTemplateWrites({ events, vectors: async () => vectors, onError: () => undefined });
    const id = newId<'Template'>();
    events.emit('library.changed', { projectId: null, entity: 'template', change: 'updated', ids: [id] });
    events.emit('library.changed', { projectId: null, entity: 'timeline', change: 'updated', ids: ['x'] });
    await flush();
    expect(vectors.synced).toEqual([[id]]);
  });

  it('does nothing while no space is open, and reports a failed sync', async () => {
    const { events } = setupNoted();
    const errors: TaalcutError[] = [];
    followTemplateWrites({ events, vectors: async () => undefined, onError: (error) => errors.push(error) });
    events.emit('library.changed', { projectId: null, entity: 'template', change: 'created', ids: ['a'] });
    await flush();
    expect(errors).toEqual([]);
    const failing = fakeVectors(err(ValidationError({ field: 'vector' })));
    followTemplateWrites({ events, vectors: async () => failing, onError: (error) => errors.push(error) });
    events.emit('library.changed', { projectId: null, entity: 'template', change: 'created', ids: ['a'] });
    await flush();
    expect(errors.map((error) => error.code)).toEqual(['core.validation']);
  });
});
