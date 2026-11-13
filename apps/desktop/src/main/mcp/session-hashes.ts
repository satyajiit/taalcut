// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How main hands the agent a bearer's hash (P3-V4), and nothing else: main mints the bearer (tokens.ts), keeps it in
 * the vault and sends only its SHA-256 over `UTILITY_CONTRACTS.agent.mcpSessions` (contract round P3-2): main →
 * agent only, never a command and never in appContract, so no window and no agent can register or rotate a hash
 * for a token it chose.
 */
import {
  callRpc,
  type AsyncResult,
  type McpClientKind,
  type McpLevel,
  type McpSessionId,
  type UtilityClient,
} from '@taalcut/core';

export interface McpNewSession {
  readonly sessionId: McpSessionId;
  readonly name: string;
  readonly client: McpClientKind;
  readonly level: McpLevel;
  readonly tokenHash: string;
}

export interface McpNewTokenHash {
  readonly sessionId: McpSessionId;
  readonly tokenHash: string;
}

export interface McpSessionHashes {
  /** Registers a session with its bearer's hash; an error means the agent stored nothing. */
  add(session: McpNewSession): AsyncResult<unknown>;
  /** Replaces a live session's hash: the old bearer stops working. */
  rotate(change: McpNewTokenHash): AsyncResult<unknown>;
}

/** The agent's mcpSessions namespace, on main's own port to it. */
export function agentSessionHashes(
  agent: () => Pick<UtilityClient<'agent'>, 'mcpSessions'>,
): McpSessionHashes {
  return {
    add: (session) => callRpc(agent().mcpSessions.addSession(session)),
    rotate: (change) => callRpc(agent().mcpSessions.rotateToken(change)),
  };
}
