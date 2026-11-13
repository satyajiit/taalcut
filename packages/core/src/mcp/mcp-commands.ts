// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MCP commands (P3-V4). App-wide (no project) and person-only: an agent, built in or external, never turns MCP
 * on, moves its port, raises a level or renames a session. Handlers: @taalcut/tools' gateway on the agent's bus,
 * each `defineCommand({ ...mcpCommandSpecs[name], handle })`, so the bus refuses the agent and MCP sources.
 * Adding a session and rotating its token are not commands: no command carries a token hash, so no caller can
 * register a bearer it chose. Main mints the bearer and hands the agent its hash over mcpSessionsContract
 * (main → agent only), and a window asks main through mcpSetup.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { PERSON_SOURCES, type CommandSource, type SideEffect } from '../commands/definition';
import { MCP_LEVELS, mcpPortSchema, mcpSessionNameSchema } from './mcp-types';

export const MCP_COMMANDS = {
  /** write, no inverse (a switch, like the privacy switches). */
  setEnabled: 'mcp.setEnabled',
  /** write; inverse the previous port. */
  setPort: 'mcp.setPort',
  /** write; inverse the previous level. */
  setSessionLevel: 'mcp.setSessionLevel',
  /** write; inverse the previous name. */
  renameSession: 'mcp.renameSession',
  /** destructive, no inverse: the bearer stops working at once. */
  revokeSession: 'mcp.revokeSession',
} as const;
export type McpCommandName = (typeof MCP_COMMANDS)[keyof typeof MCP_COMMANDS];

const sessionId = idSchema<'McpSession'>();

export const mcpCommandPayloads = {
  [MCP_COMMANDS.setEnabled]: z.object({ enabled: z.boolean() }),
  [MCP_COMMANDS.setPort]: z.object({ port: mcpPortSchema }),
  [MCP_COMMANDS.setSessionLevel]: z.object({ sessionId, level: z.enum(MCP_LEVELS) }),
  [MCP_COMMANDS.renameSession]: z.object({ sessionId, name: mcpSessionNameSchema }),
  [MCP_COMMANDS.revokeSession]: z.object({ sessionId }),
};

/** Who may dispatch an MCP command: a person at this Mac (menus, Settings, shortcuts). */
export const MCP_COMMAND_SOURCES: readonly CommandSource[] = PERSON_SOURCES;

const SIDE_EFFECTS: Record<McpCommandName, SideEffect> = {
  [MCP_COMMANDS.setEnabled]: 'write',
  [MCP_COMMANDS.setPort]: 'write',
  [MCP_COMMANDS.setSessionLevel]: 'write',
  [MCP_COMMANDS.renameSession]: 'write',
  [MCP_COMMANDS.revokeSession]: 'destructive',
};

/** Everything but the handler: spread into defineCommand so the sources can't be left out. */
function spec<N extends McpCommandName>(name: N) {
  return {
    name,
    payload: mcpCommandPayloads[name],
    sideEffect: SIDE_EFFECTS[name],
    sources: MCP_COMMAND_SOURCES,
    project: () => null,
  };
}

export const mcpCommandSpecs = {
  [MCP_COMMANDS.setEnabled]: spec(MCP_COMMANDS.setEnabled),
  [MCP_COMMANDS.setPort]: spec(MCP_COMMANDS.setPort),
  [MCP_COMMANDS.setSessionLevel]: spec(MCP_COMMANDS.setSessionLevel),
  [MCP_COMMANDS.renameSession]: spec(MCP_COMMANDS.renameSession),
  [MCP_COMMANDS.revokeSession]: spec(MCP_COMMANDS.revokeSession),
};
