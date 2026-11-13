// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM in the agent root: Settings → Memory's list and status are served, memory commands are on the bus
 * with undo, items survive a restart (the database closed and opened again), memory.remember always asks, main
 * serves only render.finished to the agent, and the agent records what worked for ready exports only.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  connectRpc,
  createEventBus,
  eventsContract,
  newId,
  ok,
  serveRpc,
  UTILITY_CONTRACTS,
  type RenderId,
  type TaalcutEvent,
} from '@taalcut/core';
import type { WhatWorkedRecorder } from '@taalcut/agent';
import { openDatabase } from '@taalcut/library';
import { mainServicesRouter } from '../src/main/composition/main-routers';
import { ToolRegistryToken } from '../src/shared/tokens';
import { followMainExports } from '../src/utility/roots/agent-memory-exports';
import type { UtilityRoot } from '../src/utility/runtime';
import { testAgent, testConfig } from './helpers/roots';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function serve(root: UtilityRoot): MessagePort {
  const { port1, port2 } = new MessageChannel();
  serveRpc(root.router, port1, { context: { caller: 'main' } });
  return port2;
}

/** A library database main created and migrated, as the app's first start leaves it. */
function migratedDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-memory-'));
  dirs.push(dir);
  const path = join(dir, 'library.sqlite');
  const db = openDatabase({ path });
  if (!db.ok) throw new Error(db.error.code);
  db.value.close();
  return path;
}

const agentClient = (root: UtilityRoot) =>
  connectRpc(UTILITY_CONTRACTS.agent, serve(root), { peer: 'agent' }).client;

describe('agent memory in the agent root (LRN1-MEM)', () => {
  it('adds, edits, undoes and deletes items through commands, lists them, and keeps them over a restart', async () => {
    const dbPath = migratedDatabase();
    const root = testAgent(testConfig('agent', dbPath));
    const client = agentClient(root);
    const memoryId = newId<'MemoryItem'>();
    await client.commands.dispatch({
      name: 'memory.create',
      payload: {
        memoryId,
        item: { scope: { kind: 'user' }, text: 'Never use whip transitions.', source: 'user' },
      },
    });
    await client.commands.dispatch({
      name: 'memory.update',
      payload: { memoryId, baseRevision: 1, patch: { text: 'No whip pans.' } },
    });
    expect((await client.memory.list({})).items.map((item) => item.text)).toEqual(['No whip pans.']);
    await client.commands.undo({ projectId: null });
    expect(await client.memory.list({})).toMatchObject({
      items: [{ text: 'Never use whip transitions.' }],
      total: 1,
    });
    expect(await client.memory.status()).toMatchObject({
      cloudPrompts: true,
      counts: { user: 1, project: 0, template: 0 },
    });
    await client.commands.dispatch({ name: 'memory.setCloudPrompts', payload: { enabled: false } });
    expect(await client.memory.status()).toMatchObject({ cloudPrompts: false });
    await root.container.dispose();

    const again = testAgent(testConfig('agent', dbPath));
    const after = agentClient(again);
    expect(await after.memory.list({ query: 'whip' })).toMatchObject({
      items: [{ id: memoryId, text: 'Never use whip transitions.', source: 'user' }],
      total: 1,
    });
    expect(await after.memory.status()).toMatchObject({ cloudPrompts: false });
    await after.commands.dispatch({ name: 'memory.delete', payload: { memoryId } });
    expect(await after.memory.list({})).toEqual({ items: [], total: 0 });
    await again.container.dispose();
  });

  it('offers memory.remember, which always asks, and memory.recall, to the agent and never to MCP', async () => {
    const root = testAgent(testConfig('agent'));
    const tools = root.container.resolve(ToolRegistryToken);
    expect(tools.describe('memory.remember')).toMatchObject({ alwaysAsk: true, sideEffect: 'write' });
    expect(tools.describe('memory.recall')).toMatchObject({ alwaysAsk: false, sideEffect: 'read' });
    await root.container.dispose();
  });
});

describe("what worked from main's exports (LRN1-MEM)", () => {
  it('main serves the agent render.finished and nothing else', async () => {
    const events = createEventBus({ clock: { now: () => 1 } });
    const router = mainServicesRouter('agent', {
      broker: { get: vi.fn(), invalidate: vi.fn(), statuses: vi.fn() } as never,
      host: { client: vi.fn() } as never,
      events,
    });
    const { port1, port2 } = new MessageChannel();
    serveRpc(router, port1, { context: { caller: 'agent' } });
    const client = connectRpc({ mainEvents: eventsContract }, port2, { peer: 'main' }).client;
    const controller = new AbortController();
    const stream = await client.mainEvents.subscribe({}, { signal: controller.signal });
    const renderId = newId<'Render'>();
    const projectId = newId<'Project'>();
    events.emit('library.changed', { projectId: null, entity: 'memory', change: 'created', ids: [] });
    events.emit('render.finished', { renderId, projectId, status: 'ready', notify: false, name: 'Goa' });
    const first = await stream[Symbol.asyncIterator]().next();
    expect(first.value).toMatchObject({ type: 'render.finished', payload: { renderId } });
    controller.abort();
  });

  it('records each ready export once it finishes, and no other outcome', async () => {
    const recorded: RenderId[] = [];
    const recorder: WhatWorkedRecorder = {
      record: async (renderId) => (recorded.push(renderId), ok('created')),
      catchUp: async () => ok(0),
    };
    const ready = newId<'Render'>();
    const finished = (renderId: RenderId, status: 'ready' | 'failed'): TaalcutEvent => ({
      type: 'render.finished',
      at: 1,
      payload: { renderId, projectId: newId<'Project'>(), status, notify: false, name: 'Goa' },
    });
    const main = {
      mainEvents: {
        subscribe: async () =>
          (async function* () {
            yield finished(newId<'Render'>(), 'failed');
            yield finished(ready, 'ready');
          })(),
      },
    };
    const follower = followMainExports(() => main as never, recorder);
    await vi.waitFor(() => expect(recorded).toEqual([ready]));
    follower.stop();
  });
});
