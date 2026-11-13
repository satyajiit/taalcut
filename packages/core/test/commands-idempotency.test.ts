// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Idempotent dispatch: a key already committed returns the original receipt and runs nothing. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  callRpc,
  commandsContract,
  commandsRouter,
  connectRpc,
  createCommandBus,
  createManualClock,
  defineCommand,
  ok,
  serveRpc,
  unwrap,
} from '@taalcut/core';
import { setupBus, UI } from './helpers/bus';
import { channel } from './helpers/ports';
import { createProjectRenameCommand } from './helpers/projects';

const AGENT = { source: 'agent', actor: 'agent:run-1' } as const;

describe('command bus: idempotency keys', () => {
  it('applies a command once per key and returns the original receipt after that', async () => {
    const { bus, store, projects, projectId } = setupBus();
    let renames = 0;
    const rename = projects.repository.rename;
    projects.repository.rename = (id, name) => {
      renames += 1;
      return rename(id, name);
    };
    const key = 'run-1:project.rename:Trip';
    const first = unwrap(
      await bus.dispatch('project.rename', { projectId, name: 'Trip' }, AGENT, { idempotencyKey: key }),
    );
    unwrap(await bus.undo(projectId, UI));
    const again = unwrap(
      await bus.dispatch('project.rename', { projectId, name: 'Trip' }, AGENT, { idempotencyKey: key }),
    );

    expect(first.deduplicated).toBe(false);
    expect(again).toEqual({ ...first, deduplicated: true });
    expect(renames).toBe(2); // the rename and its undo; the repeat ran nothing
    expect(projects.nameOf(projectId)).toBe('Untitled');
    expect(store.entries()).toHaveLength(1);
    expect(store.entries()[0]).toMatchObject({ idempotencyKey: key, result: { projectId, name: 'Trip' } });
  });

  it('remembers keys across a restart, because they live in the audit log', async () => {
    const { bus, store, projects, projectId } = setupBus();
    const key = 'k-1';
    const first = unwrap(
      await bus.dispatch('project.rename', { projectId, name: 'Trip' }, AGENT, { idempotencyKey: key }),
    );
    const restarted = createCommandBus({ store, clock: createManualClock() });
    restarted.register(createProjectRenameCommand({ projects: projects.repository }));
    const again = unwrap(
      await restarted.dispatch('project.rename', { projectId, name: 'Other' }, AGENT, {
        idempotencyKey: key,
      }),
    );
    expect(again).toMatchObject({ id: first.id, sequence: 1, deduplicated: true });
    expect(projects.nameOf(projectId)).toBe('Trip');
  });

  it('refuses a key that another command already used, and ignores keys on read commands', async () => {
    const { bus, store, projectId } = setupBus();
    let reads = 0;
    const peek = defineCommand({
      name: 'project.peek',
      payload: z.object({ projectId: z.string() }),
      sideEffect: 'read',
      handle: () => ok({ result: ++reads }),
    });
    const touch = defineCommand({
      name: 'project.touch',
      payload: z.object({ projectId: z.string() }),
      sideEffect: 'write',
      handle: () => ok({ result: 'touched' }),
    });
    bus.register(peek, touch);
    unwrap(await bus.dispatch(touch, { projectId }, UI, { idempotencyKey: 'shared' }));
    const clash = await bus.dispatch('project.rename', { projectId, name: 'x' }, UI, {
      idempotencyKey: 'shared',
    });
    expect(!clash.ok && clash.error).toMatchObject({
      code: 'core.conflict',
      params: { entity: 'command', id: 'shared' },
    });

    unwrap(await bus.dispatch(peek, { projectId }, UI, { idempotencyKey: 'read-key' }));
    expect(unwrap(await bus.dispatch(peek, { projectId }, UI, { idempotencyKey: 'read-key' })).result).toBe(
      2,
    );
    expect(store.entries()).toHaveLength(1);
  });

  it('accepts a key from the renderer, so a double click applies once', async () => {
    const { bus, store, projectId } = setupBus();
    const { port1, port2 } = channel();
    serveRpc(commandsRouter(bus), port1, { context: {} });
    const { client } = connectRpc(commandsContract, port2, { peer: 'agent' });
    const press = { name: 'project.rename', payload: { projectId, name: 'Trip' }, idempotencyKey: 'press-1' };
    const [a, b] = await Promise.all([callRpc(client.dispatch(press)), callRpc(client.dispatch(press))]);
    expect([unwrap(a).deduplicated, unwrap(b).deduplicated].sort()).toEqual([false, true]);
    expect(store.entries()).toHaveLength(1);
  });
});
