// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Registering and rotating an MCP session's bearer (P3-V4, round P3-2): main → agent only
 * (UTILITY_CONTRACTS.agent.mcpSessions: main calls it on the agent's port; the window's routes, built from
 * APP_ROUTES, never include it). Main mints `tcm_` + 32 random bytes, keeps the token in the keychain vault and hands the agent
 * only its sha256. Never in appContract and never a bus command, so neither a window, the built-in agent nor an
 * MCP client can register or rotate a hash for a token it chose; a window gets an opaque session id and a copied
 * setup text through mcpSetup. The agent's handler checks the input and stores the record (MCP_SESSIONS_SETTING);
 * nothing to undo (a bearer can't be un-issued; revoking is mcp.revokeSession).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { ipc } from '../ipc/contract';
import { MCP_CLIENT_KINDS, MCP_LEVELS, mcpSessionNameSchema, mcpTokenHashSchema } from './mcp-types';

const sessionId = idSchema<'McpSession'>();

export const mcpAddSessionSchema = z.object({
  sessionId,
  name: mcpSessionNameSchema,
  client: z.enum(MCP_CLIENT_KINDS),
  level: z.enum(MCP_LEVELS),
  tokenHash: mcpTokenHashSchema,
});
export type McpAddSession = z.output<typeof mcpAddSessionSchema>;

export const mcpRotateTokenSchema = z.object({ sessionId, tokenHash: mcpTokenHashSchema });
export type McpRotateToken = z.output<typeof mcpRotateTokenSchema>;

export const mcpSessionsContract = {
  /**
   * A new session with its bearer's hash. Refused past MCP_MAX_SESSIONS live sessions, and for a session id or
   * hash already stored (a mint is never reused).
   */
  addSession: ipc.input(mcpAddSessionSchema).output(z.object({ sessionId })),
  /** The session's new bearer hash: the old bearer stops working. core.not_found for a revoked or unknown one. */
  rotateToken: ipc.input(mcpRotateTokenSchema).output(z.void()),
};
