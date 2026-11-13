// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Round P3-2: no caller chooses an MCP bearer's hash. Main mints the token and hands the agent its hash over a
 * main-only contract; the MCP commands are person-only and carry no hash; no window procedure takes or returns one.
 */
import { getEventIteratorSchemaDetails, isContractProcedure } from '@orpc/contract';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  appContract,
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  defineCommand,
  MAIN_SERVICE_CONTRACTS,
  MCP_COMMAND_SOURCES,
  MCP_COMMANDS,
  mcpAddSessionSchema,
  mcpCommandPayloads,
  mcpCommandSpecs,
  mcpSessionsContract,
  newId,
  ok,
  PERSON_SOURCES,
  UTILITY_CONTRACTS,
  type CommandSource,
} from '@taalcut/core';
import { SHA } from './helpers/documents';
import { inputOf, outputOf } from './helpers/phase3';

const sessionId = newId<'McpSession'>();
const PAYLOADS = {
  [MCP_COMMANDS.setEnabled]: { enabled: true },
  [MCP_COMMANDS.setPort]: { port: 41_731 },
  [MCP_COMMANDS.setSessionLevel]: { sessionId, level: 'export' },
  [MCP_COMMANDS.renameSession]: { sessionId, name: 'Codex' },
  [MCP_COMMANDS.revokeSession]: { sessionId },
} as const;

type Row = readonly [path: string, input: unknown, output: unknown];

/** Every procedure of a contract tree with its input and output schemas (an event iterator's: what it yields). */
function procedures(tree: object, prefix = ''): Row[] {
  return Object.entries(tree).flatMap(([key, value]: [string, unknown]): Row[] => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isContractProcedure(value)) {
      const { inputSchema, outputSchema } = value['~orpc'];
      return [[path, inputSchema, getEventIteratorSchemaDetails(outputSchema)?.yields ?? outputSchema]];
    }
    return typeof value === 'object' && value !== null ? procedures(value, path) : [];
  });
}

/** True when the schema, read either way (what a caller sends, what it gets back), has a tokenHash property. */
function mentionsHash(schema: unknown): boolean {
  if (!(schema instanceof z.ZodType)) return false;
  return (['input', 'output'] as const).some((io) =>
    JSON.stringify(z.toJSONSchema(schema, { io, unrepresentable: 'any' })).includes('"tokenHash"'),
  );
}

describe('MCP sessions', () => {
  it('are registered and rotated by main alone, on the agent contract', () => {
    expect(UTILITY_CONTRACTS.agent.mcpSessions).toBe(mcpSessionsContract);
    expect(Object.keys(appContract)).not.toContain('mcpSessions');
    expect(Object.keys(MAIN_SERVICE_CONTRACTS.mcp)).not.toContain('mcpSessions');
    expect(Object.values(MAIN_SERVICE_CONTRACTS.mcp)).not.toContain(mcpSessionsContract);
    const add = { sessionId, name: ' Codex ', client: 'codex', level: 'read', tokenHash: SHA };
    const added = inputOf(mcpSessionsContract.addSession, add);
    expect(added.success && added.data).toEqual({ ...add, name: 'Codex' });
    expect(inputOf(mcpSessionsContract.addSession, { ...add, level: 'admin' }).success).toBe(false);
    expect(
      inputOf(mcpSessionsContract.addSession, { ...add, tokenHash: `tcm_${'a'.repeat(43)}` }).success,
    ).toBe(false);
    expect(inputOf(mcpSessionsContract.rotateToken, { sessionId, tokenHash: SHA }).success).toBe(true);
    expect(inputOf(mcpSessionsContract.rotateToken, { sessionId, tokenHash: 'x' }).success).toBe(false);
    expect(outputOf(mcpSessionsContract.addSession, { sessionId }).success).toBe(true);
    expect(mcpAddSessionSchema.shape.tokenHash).toBeDefined();
  });

  it('never take or return a hash or a token through a window procedure', () => {
    const hashed = procedures(appContract).filter(
      ([, input, output]) => mentionsHash(input) || mentionsHash(output),
    );
    expect(hashed.map(([path]) => path)).toEqual([]);
    expect(procedures(appContract).length).toBeGreaterThan(100);
    // The detector finds a hash where one is: main's own input, and the gateway's event stream.
    expect(
      procedures(UTILITY_CONTRACTS.agent.mcpSessions).filter(([, input]) => mentionsHash(input)),
    ).toHaveLength(2);
    expect(
      procedures(UTILITY_CONTRACTS.agent.mcpGateway)
        .filter(([, , output]) => mentionsHash(output))
        .map(([path]) => path),
    ).toEqual(['sessions']);
  });
});

describe('MCP commands', () => {
  it('carry no hash, and are only these five', () => {
    expect(Object.values(MCP_COMMANDS).sort()).toEqual(Object.keys(PAYLOADS).sort());
    for (const payload of Object.values(mcpCommandPayloads))
      expect(Object.keys(payload.shape)).not.toContain('tokenHash');
    expect(Object.values(MCP_COMMANDS)).not.toContain('mcp.addSession');
    expect(Object.values(MCP_COMMANDS)).not.toContain('mcp.rotateToken');
  });

  it('are person-only: the bus refuses the agent and MCP clients', async () => {
    expect(MCP_COMMAND_SOURCES).toEqual(PERSON_SOURCES);
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(1_000) });
    const handle = () => ok({ result: null });
    bus.register(defineCommand({ ...mcpCommandSpecs[MCP_COMMANDS.setEnabled], handle }));
    bus.register(defineCommand({ ...mcpCommandSpecs[MCP_COMMANDS.setPort], handle }));
    bus.register(defineCommand({ ...mcpCommandSpecs[MCP_COMMANDS.setSessionLevel], handle }));
    bus.register(defineCommand({ ...mcpCommandSpecs[MCP_COMMANDS.renameSession], handle }));
    bus.register(defineCommand({ ...mcpCommandSpecs[MCP_COMMANDS.revokeSession], handle }));
    for (const [name, payload] of Object.entries(PAYLOADS)) {
      const dispatch = (source: CommandSource) => bus.dispatch(name, payload, { source, actor: source });
      for (const source of ['agent', 'mcp'] as const) {
        const refused = await dispatch(source);
        expect(!refused.ok && refused.error.code, `${name} from ${source}`).toBe(
          'core.command_source_refused',
        );
      }
      for (const source of PERSON_SOURCES)
        expect((await dispatch(source)).ok, `${name} from ${source}`).toBe(true);
    }
  });

  it('are app-wide, with the side effect each one has', () => {
    expect(
      Object.values(mcpCommandSpecs).map((spec) => [spec.name, spec.sideEffect, spec.project()]),
    ).toEqual([
      ['mcp.setEnabled', 'write', null],
      ['mcp.setPort', 'write', null],
      ['mcp.setSessionLevel', 'write', null],
      ['mcp.renameSession', 'write', null],
      ['mcp.revokeSession', 'destructive', null],
    ]);
  });
});
