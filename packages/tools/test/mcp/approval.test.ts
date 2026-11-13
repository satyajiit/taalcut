// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V4 Done when: "an export still waits for in-app approval". At `export` level `render_export` is held for the
 * person, with progress while it waits, then answers pending with nothing run; once approved, the same call runs
 * exactly once; declined, it says so; at `edit` level it isn't listed at all. The hold is short here; the gateway's
 * default (45 s, under Codex's 60 s tool timeout) is checked against a recording runner.
 */
import {
  ok,
  systemClock,
  unwrap,
  createMemorySettingsStore,
  createCommandBus,
  createMemoryAuditLogStore,
  newId,
} from '@taalcut/core';
import {
  createMcpGateway,
  createToolRegistry,
  MCP_APPROVAL_HOLD_MS,
  tokenHash,
  type ExternalCallOptions,
} from '@taalcut/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ERAS } from './helpers/clients';
import { createMakeState, makeModules } from './helpers/domain';
import { createWorld, type World } from './helpers/world';

let world: World;

beforeEach(async () => {
  world = await createWorld({ holdMs: 300, progressEveryMs: 20 });
});

afterEach(async () => {
  await world.close();
});

describe.each(ERAS)('render_export from a %s client', (_era, connect) => {
  it('is held with progress, answers pending, then runs once after approval', async () => {
    const { token } = await world.addSession('export');
    const client = await connect(world.url, token);
    try {
      const args = { projectId: world.projectId, preset: 'reels' };
      const progress: number[] = [];
      const held = await client.callTool('render_export', args, (p) => progress.push(p.progress));
      expect(held.isError).toBe(true);
      expect(held.structuredContent).toMatchObject({ status: 'awaiting-approval' });
      expect(JSON.stringify(held.content)).toContain('Waiting for approval in Taalcut');
      expect(progress.length).toBeGreaterThan(0);
      expect(world.state.exports).toBe(0);

      const [approval] = world.runner.desk.list();
      expect(approval).toMatchObject({ tool: 'render.export', decision: 'pending' });
      expect(world.gateway.state().sessions[0]?.pendingApprovals).toBe(1);
      world.runner.desk.decide(approval?.id ?? '', 'approved');

      const done = await client.callTool('render_export', args);
      expect(done.isError).toBeFalsy();
      expect(done.structuredContent).toEqual({ renderId: 'render-1' });
      expect(world.state.exports).toBe(1);
      expect(world.gateway.state().sessions[0]?.pendingApprovals).toBe(0);

      // Asked for again once it ran, the same export is a new one: it waits for a new approval.
      const again = await client.callTool('render_export', args);
      expect(again.structuredContent).toMatchObject({ status: 'awaiting-approval' });
      expect(world.state.exports).toBe(1);
      expect(world.runner.desk.list().map((entry) => entry.decision)).toEqual(['approved', 'pending']);
    } finally {
      await client.close();
    }
  });

  it('says declined when the person says no, and runs nothing', async () => {
    const { token } = await world.addSession('export');
    const client = await connect(world.url, token);
    try {
      const args = { projectId: world.projectId, preset: 'shorts' };
      await client.callTool('render_export', args);
      const [approval] = world.runner.desk.list();
      world.runner.desk.decide(approval?.id ?? '', 'denied');
      const declined = await client.callTool('render_export', args);
      expect(declined.isError).toBe(true);
      expect(declined.structuredContent).toEqual({ status: 'declined' });
      expect(JSON.stringify(declined.content)).toContain('Declined in Taalcut.');
      expect(world.state.exports).toBe(0);
    } finally {
      await client.close();
    }
  });
});

describe('levels', () => {
  it('does not list render_export at edit level, and refuses a stale list', async () => {
    const { sessionId, token } = await world.addSession('export');
    const client = await ERAS[0][1](world.url, token);
    try {
      expect((await client.listTools()).map((tool) => tool.name)).toContain('render_export');
      await world.setLevel(sessionId, 'edit');
      expect((await client.listTools()).map((tool) => tool.name)).not.toContain('render_export');
      await expect(
        client.callTool('render_export', { projectId: world.projectId, preset: 'reels' }),
      ).rejects.toThrow(/not found/i);
      expect(world.state.exports).toBe(0);
    } finally {
      await client.close();
    }
  });

  it('answers level_too_low for a listed tool the session lost', async () => {
    const { sessionId } = await world.addSession('export');
    await world.setLevel(sessionId, 'read');
    const items = [];
    for await (const item of world.gateway.call({
      sessionId,
      callKey: 'a'.repeat(64),
      name: 'timeline_swapClip',
      arguments: { projectId: world.projectId, slot: 1, clipId: 'x' },
      wantsProgress: false,
    }))
      items.push(item);
    expect(items).toEqual([
      expect.objectContaining({
        type: 'result',
        isError: true,
        text: expect.stringContaining('"edit" level'),
      }),
    ]);
  });
});

describe('the default hold', () => {
  it('holds a deferred call for 45 s before answering pending', async () => {
    const seen: ExternalCallOptions[] = [];
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    const gateway = createMcpGateway({
      registry: unwrap(createToolRegistry(makeModules(createMakeState()))),
      runner: {
        open: async () => ok({ runId: newId<'AgentRun'>(), conversationId: newId<'Conversation'>() }),
        call: async (_runId, _name, _input, options) => {
          seen.push(options);
          return ok({ kind: 'pending', approvalId: 'a1' });
        },
        close: async () => ok(undefined),
      },
      bus,
      settings: createMemorySettingsStore(),
      clock: systemClock,
    });
    bus.register(...gateway.commands);
    unwrap(await gateway.start());
    const sessionId = newId<'McpSession'>();
    unwrap(
      await gateway.sessionWrites.add({
        sessionId,
        name: 'Codex',
        client: 'codex',
        level: 'export',
        tokenHash: tokenHash(`tcm_${'x'.repeat(43)}`),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const items = [];
    for await (const item of gateway.call({
      sessionId,
      callKey: 'b'.repeat(64),
      name: 'render_export',
      arguments: { preset: 'reels' },
      wantsProgress: true,
    }))
      items.push(item);
    expect(MCP_APPROVAL_HOLD_MS).toBe(45_000);
    expect(seen[0]).toMatchObject({
      holdMs: 45_000,
      level: 'export',
      origin: { source: 'mcp', actor: `mcp:${sessionId}` },
      requester: { kind: 'mcp', sessionId, name: 'Codex' },
    });
    expect(items.at(-1)).toMatchObject({
      structuredContent: { status: 'awaiting-approval', approvalId: 'a1' },
    });
    gateway.dispose();
  });
});
