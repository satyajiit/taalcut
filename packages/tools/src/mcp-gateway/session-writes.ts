// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Registering a session with its bearer's hash, and rotating that hash (P3-V4). Only main calls these, after it
 * minted the bearer, through `UTILITY_CONTRACTS.agent.mcpSessions` (contract round P3-2): not commands, so nothing
 * to undo (a bearer can't be un-issued; revoking is mcp.revokeSession). Checks: MCP_MAX_SESSIONS live sessions, an id
 * or hash used before, the session's external run opened before the row is stored; a rotate cancels the old
 * bearer's calls in flight.
 */
import {
  err,
  MCP_MAX_SESSIONS,
  ok,
  ValidationError,
  type AsyncResult,
  type Clock,
  type ConversationId,
  type McpClientKind,
  type McpLevel,
  type McpSessionId,
  type McpSessionRecord,
  type RunId,
  type Telemetry,
} from '@taalcut/core';
import type { CallLedger } from './call-ledger';
import { McpTooManySessions } from './errors';
import type { ExternalRunner } from './external-runner';
import type { SessionRecords } from './session-records';

export interface McpNewSession {
  readonly sessionId: McpSessionId;
  readonly name: string;
  readonly client: McpClientKind;
  readonly level: McpLevel;
  readonly tokenHash: string;
}

export interface McpSessionWritesDeps {
  readonly records: SessionRecords;
  readonly runner: ExternalRunner;
  readonly ledger: Pick<CallLedger, 'abortSession'>;
  readonly clock: Clock;
  /** `mcp.sessionCreated` (client kind and level only), with the person's consent. */
  readonly telemetry?: Telemetry;
}

export interface McpSessionWrites {
  add(
    session: McpNewSession,
  ): AsyncResult<{ sessionId: McpSessionId; runId: RunId; conversationId: ConversationId }>;
  rotate(change: { sessionId: McpSessionId; tokenHash: string }): AsyncResult<{ sessionId: McpSessionId }>;
}

export function createMcpSessionWrites(deps: McpSessionWritesDeps): McpSessionWrites {
  const { records } = deps;
  return {
    async add({ sessionId, name, client, level, tokenHash }) {
      const rows = await records.read();
      if (!rows.ok) return rows;
      if (rows.value.filter(records.live).length >= MCP_MAX_SESSIONS)
        return err(McpTooManySessions({ max: MCP_MAX_SESSIONS }));
      if (rows.value.some((record) => record.id === sessionId || record.tokenHash === tokenHash))
        return err(ValidationError({ field: 'sessionId' }, { detail: 'session id or token already used' }));
      const run = await deps.runner.open({ sessionId, name, client });
      if (!run.ok) return run;
      const record: McpSessionRecord = {
        id: sessionId,
        name,
        client,
        level,
        tokenHash,
        createdAt: deps.clock.now(),
        lastUsedAt: null,
        revokedAt: null,
        runId: run.value.runId,
        conversationId: run.value.conversationId,
      };
      const saved = await records.write(records.pruned([record, ...rows.value]));
      if (!saved.ok) {
        void deps.runner.close(run.value.runId, 'revoked');
        return saved;
      }
      deps.telemetry?.record({ name: 'mcp.sessionCreated', client, level });
      return ok({ sessionId, runId: run.value.runId, conversationId: run.value.conversationId });
    },

    async rotate({ sessionId, tokenHash }) {
      const rows = await records.read();
      if (!rows.ok) return rows;
      if (rows.value.some((record) => record.tokenHash === tokenHash))
        return err(ValidationError({ field: 'tokenHash' }, { detail: 'token already used' }));
      const rotated = await records.update(
        sessionId,
        undefined,
        (record) => ({ ...record, tokenHash }),
        () => ({ sessionId }),
      );
      // The old bearer may be mid-call: those calls end too, as on a revoke.
      if (rotated.ok) deps.ledger.abortSession(sessionId);
      return rotated;
    },
  };
}
