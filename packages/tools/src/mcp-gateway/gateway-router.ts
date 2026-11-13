// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gateway's namespaces in the agent process: `mcpGateway` (UTILITY_CONTRACTS.agent.mcpGateway, which main
 * forwards to the mcp process and to nothing else), `mcp` (Settings › External agents reads it) and `mcpSessions`
 * (main's alone: a new session or bearer by its hash, after main minted the bearer). Other changes are MCP_COMMANDS
 * on the bus.
 */
import {
  implementContract,
  mcpContract,
  mcpGatewayContract,
  mcpSessionsContract,
  unwrapRpc,
} from '@taalcut/core';
import type { McpGateway } from './gateway';

export function mcpGatewayRouter(gateway: McpGateway) {
  const os = implementContract(mcpGatewayContract);
  return os.router({
    sessions: os.sessions.handler(({ signal }) => gateway.sessions(signal)),
    listTools: os.listTools.handler(({ input }) => unwrapRpc(gateway.listTools(input.sessionId))),
    call: os.call.handler(({ input, signal }) => gateway.call(input, signal)),
    touch: os.touch.handler(({ input }) => {
      unwrapRpc(gateway.touch(input.sessionId));
    }),
    reportStatus: os.reportStatus.handler(({ input }) => gateway.reportStatus(input)),
  });
}

export function mcpRouter(gateway: Pick<McpGateway, 'state' | 'changed'>) {
  const os = implementContract(mcpContract);
  return os.router({
    state: os.state.handler(() => gateway.state()),
    changed: os.changed.handler(({ signal }) => gateway.changed(signal)),
  });
}

export function mcpSessionsRouter(gateway: Pick<McpGateway, 'sessionWrites'>) {
  const os = implementContract(mcpSessionsContract);
  return os.router({
    addSession: os.addSession.handler(async ({ input }) => {
      const added = unwrapRpc(await gateway.sessionWrites.add(input));
      return { sessionId: added.sessionId };
    }),
    rotateToken: os.rotateToken.handler(async ({ input }) => {
      unwrapRpc(await gateway.sessionWrites.rotate(input));
    }),
  });
}
