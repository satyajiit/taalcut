// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the mcp process needs of the gateway: core's mcpGatewayContract as plain calls. The desktop passes the RPC
 * client of MAIN_SERVICE_CONTRACTS.mcp.gateway (main forwards it to the agent process); tests pass a stand-in.
 * Calls reject with core's RPC errors (fromRpcError reads them).
 */
import type { McpCallItem, McpServerStatus, McpSessionId, McpToolDef } from '@taalcut/core';
import type { McpCallInput } from '../mcp-gateway/call-flow';
import type { GatewaySessionsSnapshot } from './session-cache';

export interface CallOptions {
  readonly signal?: AbortSignal;
}

export interface McpGatewayClient {
  sessions(input: undefined, options: CallOptions): Promise<AsyncIterable<GatewaySessionsSnapshot>>;
  listTools(input: {
    sessionId: McpSessionId;
  }): Promise<{ readonly tools: readonly McpToolDef[]; readonly instructions: string }>;
  call(input: McpCallInput, options: CallOptions): Promise<AsyncIterable<McpCallItem>>;
  touch(input: { sessionId: McpSessionId; protocolSession?: string }): Promise<void>;
  reportStatus(status: McpServerStatus): Promise<void>;
}
