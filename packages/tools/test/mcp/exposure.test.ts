// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V4 exposure: every registry tool except the hidden ones maps to an MCP tool with all four annotations set;
 * levels filter the list; a new domain module reaches MCP clients with no change to the gateway.
 */
import {
  createCommandBus,
  createMemoryAuditLogStore,
  createMemorySettingsStore,
  newId,
  ok,
  systemClock,
  unwrap,
  type McpLevel,
} from '@taalcut/core';
import {
  createMcpGateway,
  createToolRegistry,
  exposedTools,
  isExposed,
  levelNeeded,
  tokenHash,
  toMcpToolDef,
  type ToolRegistry,
} from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { fakeServices } from '../helpers';
import { createTestDomainTools } from '../test-domain';
import { createMakeState, makeModules } from './helpers/domain';

function registry(): ToolRegistry {
  return unwrap(createToolRegistry(makeModules(createMakeState())));
}

function names(level: McpLevel, from: ToolRegistry = registry()): string[] {
  return exposedTools(from, level).map((tool) => tool.name);
}

describe('exposure', () => {
  it('maps every exposed tool with all four annotations and its schemas', () => {
    const all = exposedTools(registry(), 'export');
    expect(all.map((tool) => tool.name)).toEqual([
      'cloud_describe',
      'render_export',
      'templates_breakdown',
      'timeline_clearSlot',
      'timeline_swapClip',
    ]);
    for (const tool of all) {
      expect(Object.keys(tool.annotations).sort()).toEqual([
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
        'readOnlyHint',
      ]);
      expect(tool.inputSchema['type']).toBe('object');
    }
    const by = Object.fromEntries(all.map((tool) => [tool.name, tool]));
    expect(by['templates_breakdown']?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(by['timeline_clearSlot']?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(by['timeline_swapClip']?.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(by['cloud_describe']?.annotations.openWorldHint).toBe(true);
    expect(by['cloud_describe']?.description).toContain('Costs money');
    expect(by['render_export']?.description).toContain('Needs your approval in Taalcut before it runs.');
    expect(by['templates_breakdown']?.outputSchema?.['type']).toBe('object');
  });

  it('hides the sandbox family and tools that opt out', () => {
    const from = registry();
    expect(names('export', from)).not.toContain('sandbox_listExperiments');
    expect(names('export', from)).not.toContain('secret_peek');
    const sandbox = from.resolve('sandbox.listExperiments');
    expect(sandbox && isExposed(sandbox.descriptor)).toBe(false);
  });

  it('lists by level: read, then edit (write and destructive), then export (external and checkpoints)', () => {
    expect(names('read')).toEqual(['templates_breakdown']);
    expect(names('edit')).toEqual(['templates_breakdown', 'timeline_clearSlot', 'timeline_swapClip']);
    expect(names('export')).toHaveLength(5);
    const render = registry().resolve('render.export');
    expect(render && levelNeeded(render.descriptor)).toBe('export');
  });

  it('leaves the output schema out when its root is not an object, and clips long text', () => {
    const tool = registry().resolve('templates.breakdown');
    if (!tool) throw new Error('missing tool');
    const def = toMcpToolDef({
      ...tool,
      descriptor: { ...tool.descriptor, summary: 's'.repeat(300), description: 'd'.repeat(5000) },
      schemas: { ...tool.schemas, output: { type: 'array' } },
    });
    expect(def.outputSchema).toBeUndefined();
    expect(def.title).toHaveLength(200);
    expect(def.description).toHaveLength(4000);
  });
});

describe('a new domain module', () => {
  it('reaches an MCP session with no change to the gateway', async () => {
    const tools = registry();
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    const gateway = createMcpGateway({
      registry: tools,
      runner: {
        open: async () => ok({ runId: newId<'AgentRun'>(), conversationId: newId<'Conversation'>() }),
        call: async () => ok({ kind: 'declined' }),
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
        name: 'Agent',
        client: 'other',
        level: 'read',
        tokenHash: tokenHash(`tcm_${'q'.repeat(43)}`),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = unwrap(gateway.listTools(sessionId)).tools.map((tool) => tool.name);
    expect(before).not.toContain('testdomain_countWords');

    unwrap(tools.register(createTestDomainTools(fakeServices())));
    const after = unwrap(gateway.listTools(sessionId));
    expect(after.tools.map((tool) => tool.name)).toContain('testdomain_countWords');
    expect(after.instructions).toContain('templates_breakdown');
    gateway.dispose();
  });
});
