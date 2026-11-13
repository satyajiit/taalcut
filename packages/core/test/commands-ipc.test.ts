// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The command bus over IPC, as the renderer uses it. */
import { describe, expect, it } from 'vitest';
import {
  callRpc,
  COMMAND_PAYLOAD_LIMITS,
  commandsContract,
  commandsRouter,
  connectRpc,
  serveRpc,
  withinJsonLimits,
} from '@taalcut/core';
import { setupBus } from './helpers/bus';
import { channel } from './helpers/ports';

function connect() {
  const setup = setupBus();
  const { port1, port2 } = channel();
  serveRpc(commandsRouter(setup.bus), port1, { context: {} });
  return { ...setup, client: connectRpc(commandsContract, port2, { peer: 'agent' }).client };
}

describe('commands over IPC', () => {
  it('dispatches, undoes and redoes from the renderer as the user', async () => {
    const { client, store, projects, projectId } = connect();
    const receipt = await client.dispatch({ name: 'project.rename', payload: { projectId, name: 'Trip' } });
    expect(receipt).toMatchObject({ name: 'project.rename', projectId, sequence: 1, undoable: true });
    expect(store.entries()[0]).toMatchObject({ source: 'ui', actor: 'user' });
    expect(await client.history({ projectId })).toEqual({ undo: 'project.rename', redo: null });
    expect(await client.undo({ projectId, source: 'shortcut' })).toEqual({
      id: receipt.id,
      name: 'project.rename',
      projectId,
      result: { projectId, name: 'Untitled' },
    });
    expect(projects.nameOf(projectId)).toBe('Untitled');
    expect(await client.redo({ projectId })).toMatchObject({ result: { projectId, name: 'Trip' } });
    expect(projects.nameOf(projectId)).toBe('Trip');
    expect(await client.list()).toEqual([
      {
        name: 'project.rename',
        sideEffect: 'write',
        labelKey: 'commands.project.rename',
        needsPayload: true,
      },
    ]);
  });

  it('refuses to let the renderer pose as the agent, and passes payload errors through typed', async () => {
    const { client, projectId } = connect();
    const posing = await callRpc(
      client.dispatch({
        name: 'project.rename',
        payload: { projectId, name: 'x' },
        source: 'agent' as never,
      }),
    );
    expect(!posing.ok && posing.error).toMatchObject({
      code: 'core.validation',
      params: { field: 'source' },
    });
    const empty = await callRpc(
      client.dispatch({ name: 'project.rename', payload: { projectId, name: '' } }),
    );
    expect(!empty.ok && empty.error).toMatchObject({ code: 'core.validation', params: { field: 'name' } });
  });

  it('refuses a payload too large or too deeply nested before the bus sees it', async () => {
    const { client, store, projectId } = connect();
    const nested = (depth: number): unknown => (depth === 0 ? 'x' : { a: nested(depth - 1) });
    const tooLarge = { projectId, name: 'x'.repeat(COMMAND_PAYLOAD_LIMITS.maxBytes) };
    for (const payload of [tooLarge, nested(COMMAND_PAYLOAD_LIMITS.maxDepth + 1)]) {
      const refused = await callRpc(client.dispatch({ name: 'project.rename', payload }));
      expect(!refused.ok && refused.error).toMatchObject({
        code: 'core.validation',
        params: { field: 'payload' },
      });
    }
    expect(store.entries()).toEqual([]);
    // Within the limits, the command's own schema decides.
    const deepButSmall = await callRpc(client.dispatch({ name: 'project.rename', payload: nested(31) }));
    expect(!deepButSmall.ok && deepButSmall.error).toMatchObject({ code: 'core.validation' });
    expect(!deepButSmall.ok && deepButSmall.error.params).not.toEqual({ field: 'payload' });
  });
});

describe('withinJsonLimits', () => {
  const limits = { maxBytes: 20, maxDepth: 2 };

  it('measures the value as JSON: bytes in UTF-8, arrays and objects by depth', () => {
    expect(withinJsonLimits({ a: [1, 2] }, limits)).toBe(true); // {"a":[1,2]} is 11 bytes
    expect(withinJsonLimits({ a: [[1]] }, limits)).toBe(false);
    expect(withinJsonLimits('x'.repeat(18), limits)).toBe(true); // 20 with quotes
    expect(withinJsonLimits('x'.repeat(19), limits)).toBe(false);
    expect(withinJsonLimits('é'.repeat(9), limits)).toBe(true); // 2 bytes each
    expect(withinJsonLimits('é'.repeat(10), limits)).toBe(false);
    expect(withinJsonLimits({ ['k'.repeat(16)]: 1 }, limits)).toBe(false);
    expect(withinJsonLimits(undefined, limits)).toBe(true);
  });

  it('stops early on a huge or cyclic value', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(withinJsonLimits(cyclic, { maxBytes: 1_000_000, maxDepth: 32 })).toBe(false);
    expect(withinJsonLimits(new Array(10_000_000).fill(0), { maxBytes: 1_000, maxDepth: 32 })).toBe(false);
  });
});
