// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V4 Done when, package level: a 2026-07-28 client (Claude Code's v2 runtime) and a 2025-11-25 client (Codex's
 * default lifecycle) each list the tools at `edit`, break a reference down and swap a clip through MCP. The bus
 * gets one dispatch per swap with source `mcp` and the session's actor, and `taalcut_undo` undoes it on the same
 * history ⌘Z uses.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ERAS } from './helpers/clients';
import { createWorld, type World } from './helpers/world';

let world: World;

beforeEach(async () => {
  world = await createWorld();
});

afterEach(async () => {
  await world.close();
});

describe.each(ERAS)('an MCP client on %s', (era, connect) => {
  it('lists the edit tools, runs a breakdown and a swap, and undoes the swap', async () => {
    const { sessionId, token } = await world.addSession('edit', `${era} agent`);
    const client = await connect(world.url, token);
    try {
      const names = (await client.listTools()).map((tool) => tool.name).sort();
      expect(names).toEqual([
        'taalcut_history',
        'taalcut_redo',
        'taalcut_undo',
        'templates_breakdown',
        'timeline_clearSlot',
        'timeline_swapClip',
      ]);

      const breakdown = await client.callTool('templates_breakdown', { reference: 'reel.mp4' });
      expect(breakdown.isError).toBeFalsy();
      expect(breakdown.structuredContent).toEqual({
        slots: [
          { index: 1, seconds: 1.5 },
          { index: 2, seconds: 3 },
          { index: 3, seconds: 4.5 },
        ],
      });

      const swap = await client.callTool('timeline_swapClip', {
        projectId: world.projectId,
        slot: 2,
        clipId: 'clip-z',
      });
      expect(swap.isError).toBeFalsy();
      expect(swap.structuredContent).toEqual({ slot: 2, clipId: 'clip-z' });
      expect(world.state.slots.get(2)).toBe('clip-z');

      const rows = world.audit.entries().filter((entry) => entry.name === 'timeline.swapClip');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source: 'mcp', actor: `mcp:${sessionId}`, projectId: world.projectId });

      const history = await client.callTool('taalcut_history', { projectId: world.projectId });
      expect(history.structuredContent).toEqual({ undo: 'timeline.swapClip', redo: null });
      const undo = await client.callTool('taalcut_undo', { projectId: world.projectId });
      expect(undo.structuredContent).toEqual({ command: 'timeline.swapClip' });
      expect(world.state.slots.get(2)).toBe('clip-b');
    } finally {
      await client.close();
    }
  });
});

describe('one history for the app and MCP', () => {
  it("lets the person's undo reverse an MCP edit and MCP's undo reverse the person's", async () => {
    const { token } = await world.addSession('edit');
    const client = await ERAS[0][1](world.url, token);
    try {
      await client.callTool('timeline_swapClip', { projectId: world.projectId, slot: 1, clipId: 'clip-m' });
      const undone = await world.bus.undo(world.projectId, { source: 'shortcut', actor: 'user' });
      expect(undone.ok && undone.value?.name).toBe('timeline.swapClip');
      expect(world.state.slots.get(1)).toBe('clip-a');

      await world.bus.dispatch(
        'timeline.swapClip',
        { projectId: world.projectId, slot: 3, clipId: 'clip-p' },
        { source: 'ui', actor: 'user' },
      );
      await client.callTool('taalcut_undo', { projectId: world.projectId });
      expect(world.state.slots.get(3)).toBe('clip-c');
    } finally {
      await client.close();
    }
  });

  it("applies a repeated identical swap once (the tool's idempotency key; the call itself runs again)", async () => {
    const { token } = await world.addSession('edit');
    const client = await ERAS[1][1](world.url, token);
    try {
      const args = { projectId: world.projectId, slot: 2, clipId: 'clip-q' };
      await client.callTool('timeline_swapClip', args);
      await client.callTool('timeline_swapClip', args);
      expect(world.audit.entries().filter((entry) => entry.name === 'timeline.swapClip')).toHaveLength(1);
    } finally {
      await client.close();
    }
  });
});
