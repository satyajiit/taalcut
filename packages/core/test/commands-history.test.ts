// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Command bus: side-effect levels, restart recovery, store failures during undo and redo, registry. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createCommandBus,
  createManualClock,
  defineCommand,
  defineError,
  err,
  ok,
  unwrap,
  type CommandListener,
} from '@taalcut/core';
import { setupBus, UI } from './helpers/bus';
import { createProjectRenameCommand } from './helpers/projects';

const Offline = defineError('test.offline', { retryable: true });

describe('command bus: side-effect levels', () => {
  it('runs read commands without auditing them and logs non-undoable commands without an inverse', async () => {
    const { bus, store, projects, projectId } = setupBus();
    const peek = defineCommand({
      name: 'project.peek',
      payload: z.object({ projectId: z.string() }),
      sideEffect: 'read',
      handle: async ({ projectId: id }) => ok({ result: projects.nameOf(id as typeof projectId) }),
    });
    const publish = defineCommand({
      name: 'project.publish',
      payload: z.object({ projectId: z.string() }),
      sideEffect: 'external',
      labelKey: 'commands.publish',
      handle: () => ok({ result: 'posted' }),
    });
    bus.register(peek, publish);

    expect(unwrap(await bus.dispatch(peek, { projectId }, UI))).toMatchObject({
      result: 'Untitled',
      sequence: null,
    });
    expect(store.entries()).toHaveLength(0);

    unwrap(await bus.dispatch('project.rename', { projectId, name: 'Trip' }, UI));
    unwrap(await bus.undo(projectId, UI));
    const posted = unwrap(await bus.dispatch(publish, { projectId }, UI));
    expect(posted).toMatchObject({ result: 'posted', undoable: false, sequence: 2 });
    expect(store.entries()[1]).toMatchObject({
      name: 'project.publish',
      inverse: null,
      sideEffect: 'external',
    });
    expect(unwrap(await bus.history(projectId))).toEqual({ undo: null, redo: null });
  });

  it('lists commands for the palette and refuses duplicate or badly named commands', () => {
    const { bus, projects } = setupBus();
    expect(bus.list()).toEqual([
      {
        name: 'project.rename',
        sideEffect: 'write',
        labelKey: 'commands.project.rename',
        needsPayload: true,
      },
    ]);
    expect(() => bus.register(createProjectRenameCommand({ projects: projects.repository }))).toThrow(
      /twice/,
    );
    expect(() =>
      defineCommand({
        name: 'Rename',
        payload: z.object({}),
        sideEffect: 'write',
        handle: () => ok({ result: 1 }),
      }),
    ).toThrow(/Invalid command name/);
  });
});

describe('command bus: restart recovery', () => {
  it('rebuilds undo and redo stacks from the audit log in a new bus', async () => {
    const { bus, store, projects, projectId } = setupBus();
    for (const name of ['One', 'Two', 'Three'])
      unwrap(await bus.dispatch('project.rename', { projectId, name }, UI));
    unwrap(await bus.undo(projectId, UI));

    const restarted = createCommandBus({ store, clock: createManualClock(5_000) });
    restarted.register(createProjectRenameCommand({ projects: projects.repository }));
    expect(unwrap(await restarted.history(projectId))).toEqual({
      undo: 'project.rename',
      redo: 'project.rename',
    });
    unwrap(await restarted.redo(projectId, UI));
    expect(projects.nameOf(projectId)).toBe('Three');
    unwrap(await restarted.undo(projectId, UI));
    unwrap(await restarted.undo(projectId, UI));
    unwrap(await restarted.undo(projectId, UI));
    expect(projects.nameOf(projectId)).toBe('Untitled');
    expect(unwrap(await restarted.undo(projectId, UI))).toBeNull();
  });

  it('does not offer to redo commands cut off by a later command', async () => {
    const { bus, store, projects, projectId } = setupBus();
    unwrap(await bus.dispatch('project.rename', { projectId, name: 'One' }, UI));
    unwrap(await bus.undo(projectId, UI));
    unwrap(await bus.dispatch('project.rename', { projectId, name: 'Two' }, UI));
    const restarted = createCommandBus({ store, clock: createManualClock(), maxHistory: 1 });
    restarted.register(createProjectRenameCommand({ projects: projects.repository }));
    expect(unwrap(await restarted.history(projectId))).toEqual({ undo: 'project.rename', redo: null });
  });

  it('reports a store that cannot load the history', async () => {
    const { bus, projectId } = setupBus({
      store: (memory) => ({ ...memory, listByProject: async () => err(Offline()) }),
    });
    const result = await bus.dispatch('project.rename', { projectId, name: 'x' }, UI);
    expect(!result.ok && result.error.code).toBe('test.offline');
    expect((await bus.undo(projectId, UI)).ok).toBe(false);
    expect((await bus.history(projectId)).ok).toBe(false);
  });
});

describe('command bus: store failures during undo and redo', () => {
  it('re-applies the command when an undo cannot be recorded', async () => {
    const { bus, projects, projectId } = setupBus({
      store: (memory) => ({ ...memory, markUndone: async () => err(Offline()) }),
    });
    unwrap(await bus.dispatch('project.rename', { projectId, name: 'Trip' }, UI));
    const result = await bus.undo(projectId, UI);
    expect(!result.ok && result.error.code).toBe('test.offline');
    expect(projects.nameOf(projectId)).toBe('Trip');
    expect(unwrap(await bus.history(projectId))).toEqual({ undo: 'project.rename', redo: null });
  });

  it('reverses the command again when a redo cannot be recorded', async () => {
    const { bus, projects, projectId } = setupBus({
      store: (memory) => ({ ...memory, markRedone: async () => err(Offline()) }),
    });
    unwrap(await bus.dispatch('project.rename', { projectId, name: 'Trip' }, UI));
    unwrap(await bus.undo(projectId, UI));
    const result = await bus.redo(projectId, UI);
    expect(!result.ok && result.error.code).toBe('test.offline');
    expect(projects.nameOf(projectId)).toBe('Untitled');
  });

  it('fails undo cleanly when the inverse names an unknown command or carries a bad payload', async () => {
    const { bus, projectId } = setupBus();
    const orphan = defineCommand({
      name: 'project.orphan',
      payload: z.object({ projectId: z.string() }),
      sideEffect: 'write',
      handle: ({ projectId: id }) =>
        ok({ result: null, inverse: { name: 'project.gone', payload: { projectId: id } } }),
    });
    const sloppy = defineCommand({
      name: 'project.sloppy',
      payload: z.object({ projectId: z.string() }),
      sideEffect: 'write',
      handle: ({ projectId: id }) =>
        ok({ result: null, inverse: { name: 'project.rename', payload: { projectId: id } } }),
    });
    bus.register(orphan, sloppy);
    unwrap(await bus.dispatch(orphan, { projectId }, UI));
    const gone = await bus.undo(projectId, UI);
    expect(!gone.ok && gone.error.params).toEqual({ entity: 'command', id: 'project.gone' });

    const { bus: other, projectId: otherId } = setupBus();
    other.register(sloppy);
    unwrap(await other.dispatch(sloppy, { projectId: otherId }, UI));
    const bad = await other.undo(otherId, UI);
    expect(!bad.ok && bad.error).toMatchObject({ code: 'core.validation', params: { field: 'name' } });
  });
});

describe('command bus: listeners', () => {
  it('tells listeners about executed, undone and redone commands until they unsubscribe', async () => {
    const { bus, projectId } = setupBus();
    const seen: string[] = [];
    const listener: CommandListener = (change) =>
      seen.push(`${change.kind}:${change.name}:${change.origin.source}`);
    const off = bus.subscribe(listener);
    unwrap(await bus.dispatch('project.rename', { projectId, name: 'Trip' }, UI));
    unwrap(await bus.undo(projectId, { source: 'shortcut', actor: 'user' }));
    unwrap(await bus.redo(projectId, UI));
    off();
    unwrap(await bus.undo(projectId, UI));
    expect(seen).toEqual([
      'executed:project.rename:ui',
      'undone:project.rename:shortcut',
      'redone:project.rename:ui',
    ]);
  });

  it('keeps app-wide commands in their own history', async () => {
    const { bus, store } = setupBus();
    let theme = 'system';
    const setTheme = defineCommand({
      name: 'settings.setTheme',
      payload: z.object({ preference: z.enum(['system', 'light', 'dark']) }),
      sideEffect: 'write',
      handle: ({ preference }) => {
        const before = theme;
        theme = preference;
        return ok({
          result: preference,
          inverse: { name: 'settings.setTheme', payload: { preference: before } },
        });
      },
    });
    bus.register(setTheme);
    unwrap(await bus.dispatch(setTheme, { preference: 'dark' }, UI));
    expect(store.entries()[0]).toMatchObject({ projectId: null, sequence: 1 });
    unwrap(await bus.undo(null, UI));
    expect(theme).toBe('system');
  });
});
