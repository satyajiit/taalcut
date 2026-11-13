// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One tools/call through the bridge: forwarded to the gateway with the session's call key, its items turned into
 * MCP progress notifications (when the client asked for them) and one result. A gateway failure becomes an error
 * result the client can show, except an unknown tool, which is the protocol's "invalid params".
 */
import {
  ProtocolError,
  ProtocolErrorCode,
  type CallToolResult,
  type ServerContext,
} from '@modelcontextprotocol/server';
import {
  fromRpcError,
  type Clock,
  type McpCallItem,
  type McpLevel,
  type McpSessionId,
  type McpToolDef,
} from '@taalcut/core';
import { contentHash } from '../hash';
import { isPlainObject } from '../plain-object';
import { mcpErrorText } from '../mcp-gateway/errors';
import type { McpGatewayClient } from './gateway-port';

/** What the request pipeline hands the factory through `authInfo.extra`. */
export interface BridgeSession {
  readonly sessionId: McpSessionId;
  readonly level: McpLevel;
}

interface BridgeCallDeps {
  readonly gateway: Pick<McpGatewayClient, 'call'>;
  readonly clock: Clock;
}

const DAY_MS = 24 * 60 * 60_000;
export const RESTARTED = 'Taalcut restarted part of itself. Call again.';

/** Stable for the same session, tool and arguments for a day (tools SPEC, "A call", step 4). */
export function mcpCallKey(sessionId: string, name: string, args: unknown, now: number): string {
  return contentHash({ sessionId, name, args, day: Math.floor(now / DAY_MS) });
}

function textResult(text: string, isError: boolean): CallToolResult {
  return { content: [{ type: 'text', text }], isError };
}

function toResult(item: Extract<McpCallItem, { type: 'result' }>): CallToolResult {
  return {
    content: [{ type: 'text', text: item.text }],
    ...(item.structuredContent ? { structuredContent: item.structuredContent } : {}),
    isError: item.isError,
  };
}

type ProgressItem = Extract<McpCallItem, { type: 'progress' }>;

/**
 * Sends each progress item as a notification. MCP progress must grow with every notification; a held approval
 * has no fraction, only ticks.
 */
function progressNotifier(ctx: ServerContext, progressToken: string | number) {
  let last = 0;
  return async (item: ProgressItem): Promise<void> => {
    const value = item.fraction === null ? last + 1 : Math.max(last + 0.01, item.fraction * 100);
    last = value;
    await ctx.mcpReq.notify({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress: value,
        ...(item.fraction === null ? {} : { total: 100 }),
        ...(item.message ? { message: item.message } : {}),
      },
    });
  };
}

/** A failed call as the client sees it; an unknown tool is a protocol error, as the spec says. */
function failedCall(cause: unknown, tool: string): CallToolResult {
  const error = fromRpcError(cause);
  if (error.code === 'tools.not_found')
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Tool ${tool} not found`);
  if (error.code === 'core.process_restarted') return textResult(RESTARTED, true);
  return textResult(mcpErrorText(error) ?? `Taalcut couldn't do that (${error.code}).`, true);
}

/** The SDK's handler for one listed tool of this session. */
export function bridgeCall(deps: BridgeCallDeps, session: BridgeSession, def: McpToolDef) {
  return async (args: unknown, ctx: ServerContext): Promise<CallToolResult> => {
    // The SDK has checked `args` against the tool's object schema already.
    const input = isPlainObject(args) ? args : {};
    const progressToken = ctx.mcpReq._meta?.progressToken;
    const notify = progressToken === undefined ? undefined : progressNotifier(ctx, progressToken);
    try {
      const items = await deps.gateway.call(
        {
          sessionId: session.sessionId,
          callKey: mcpCallKey(session.sessionId, def.name, input, deps.clock.now()),
          name: def.name,
          arguments: input,
          wantsProgress: notify !== undefined,
        },
        { signal: ctx.mcpReq.signal },
      );
      for await (const item of items) {
        if (item.type === 'result') return toResult(item);
        await notify?.(item);
      }
      return textResult(RESTARTED, true);
    } catch (cause) {
      return failedCall(cause, def.name);
    }
  };
}
