// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One MCP server instance per request (the SDK's per-request factory), carrying exactly the tools the session's
 * level lists, as the gateway describes them. A call goes to the gateway (in the agent process, through main) and
 * comes back as progress notifications and one result (bridge-call.ts). The SDK checks the arguments against the
 * tool's input schema before anything is forwarded; a tool the session doesn't list is "not found", as the spec
 * says.
 */
import {
  fromJsonSchema,
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  type McpRequestContext,
  type McpServerFactory,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { fromRpcError, type Clock, type McpSessionId, type McpToolDef } from '@taalcut/core';
import { mcpErrorText } from '../mcp-gateway/errors';
import { bridgeCall, RESTARTED, type BridgeSession } from './bridge-call';
import type { McpGatewayClient } from './gateway-port';

export { mcpCallKey, type BridgeSession } from './bridge-call';

export interface ToolBridgeDeps {
  readonly gateway: Pick<McpGatewayClient, 'listTools' | 'call'>;
  readonly clock: Clock;
  readonly version: string;
}

type ListedTools = Awaited<ReturnType<McpGatewayClient['listTools']>>;

function sessionOf(ctx: McpRequestContext): BridgeSession {
  const extra = ctx.authInfo?.extra;
  const sessionId = extra?.['sessionId'];
  const level = extra?.['level'];
  if (typeof sessionId !== 'string' || (level !== 'read' && level !== 'edit' && level !== 'export')) {
    // The pipeline always sets both; reaching here is a wiring bug, not a client mistake.
    throw new ProtocolError(ProtocolErrorCode.InternalError, 'No session for this request');
  }
  return { sessionId: sessionId as McpSessionId, level };
}

/** Converted schemas, reused across the per-request instances. */
function schemaCache() {
  const cache = new Map<string, StandardSchemaWithJSON>();
  return (schema: Readonly<Record<string, unknown>>): StandardSchemaWithJSON => {
    const key = JSON.stringify(schema);
    let converted = cache.get(key);
    if (!converted) {
      converted = fromJsonSchema(schema);
      cache.set(key, converted);
    }
    return converted;
  };
}

/** The session's tools and instructions; a gateway failure is the protocol's internal error. */
async function listFor(deps: ToolBridgeDeps, session: BridgeSession): Promise<ListedTools> {
  try {
    return await deps.gateway.listTools({ sessionId: session.sessionId });
  } catch (cause) {
    const error = fromRpcError(cause);
    throw new ProtocolError(
      ProtocolErrorCode.InternalError,
      error.code === 'core.process_restarted' ? RESTARTED : (mcpErrorText(error) ?? error.code),
    );
  }
}

export function createToolBridge(deps: ToolBridgeDeps): McpServerFactory {
  const schema = schemaCache();

  const register = (server: McpServer, session: BridgeSession, def: McpToolDef): void => {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: schema(def.inputSchema),
        ...(def.outputSchema ? { outputSchema: schema(def.outputSchema) } : {}),
        annotations: def.annotations,
      },
      bridgeCall(deps, session, def),
    );
  };

  return async (ctx) => {
    const session = sessionOf(ctx);
    const listed = await listFor(deps, session);
    const server = new McpServer(
      { name: 'taalcut', version: deps.version },
      { capabilities: { tools: {} }, instructions: listed.instructions },
    );
    for (const def of listed.tools) register(server, session, def);
    return server;
  };
}
