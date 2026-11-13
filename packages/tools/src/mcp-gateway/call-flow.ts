// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One tools/call from an MCP client (tools SPEC, "A call"): the session must be live, the tool exposed and allowed
 * at the session's level; a native tool (undo, redo) runs here, any other through the external runner
 * (external-call.ts), which streams progress and then exactly one result.
 */
import {
  err,
  ok,
  toRpcError,
  type McpCallItem,
  type McpSessionId,
  type McpSessionRecord,
  type Result,
} from '@taalcut/core';
import { ToolNotFound } from '../errors';
import type { CallFlowDeps, McpCallInput } from './call-types';
import { McpLevelTooLow, McpSessionExpired, McpSessionRevoked } from './errors';
import { exposedTool } from './exposure';
import { runExternalCall } from './external-call';
import type { McpOrigin } from './external-runner';
import type { NativeTool } from './history-tools';
import { levelAllows } from './levels';
import { errorItem, structuredItem } from './results';
import type { McpSessionStore } from './sessions';

export type { CallFlowDeps, McpCallInput } from './call-types';

/** The live session, or why its bearer no longer works (the mcp process answers 401). */
export function liveSession(
  sessions: Pick<McpSessionStore, 'get' | 'state'>,
  sessionId: McpSessionId,
): Result<McpSessionRecord> {
  const record = sessions.get(sessionId);
  if (!record) return err(McpSessionRevoked({ sessionId }, { detail: 'unknown session' }));
  const state = sessions.state(record);
  if (state === 'revoked') return err(McpSessionRevoked({ sessionId }));
  if (state === 'expired') return err(McpSessionExpired({ sessionId }));
  return ok(record);
}

export function originOf(sessionId: McpSessionId): McpOrigin {
  return { source: 'mcp', actor: `mcp:${sessionId}` };
}

/** A native tool (taalcut_undo, taalcut_redo): checked against the session's level, run here, one result. */
async function runNative(
  native: NativeTool,
  record: McpSessionRecord,
  input: McpCallInput,
  origin: McpOrigin,
): Promise<McpCallItem> {
  if (!levelAllows(record.level, native.needed))
    return errorItem(McpLevelTooLow({ level: record.level, needed: native.needed }));
  const ran = await native.run(input.arguments, origin);
  return ran.ok ? structuredItem(ran.value) : errorItem(ran.error);
}

export async function* runMcpCall(
  deps: CallFlowDeps,
  input: McpCallInput,
  signal?: AbortSignal,
): AsyncGenerator<McpCallItem, void, undefined> {
  const session = liveSession(deps.sessions, input.sessionId);
  if (!session.ok) throw toRpcError(session.error);
  const record = session.value;
  const origin = originOf(record.id);
  deps.ledger.counted(record.id);

  const native = deps.natives.get(input.name);
  if (native) {
    yield await runNative(native, record, input, origin);
    return;
  }

  const exposed = exposedTool(deps.registry, input.name);
  if (!exposed) throw toRpcError(ToolNotFound({ tool: input.name }));
  if (levelAllows(record.level, exposed.needed)) {
    yield* runExternalCall(deps, { record, tool: exposed.tool.descriptor.name, input, origin }, signal);
  } else {
    yield errorItem(McpLevelTooLow({ level: record.level, needed: exposed.needed }));
  }
}
