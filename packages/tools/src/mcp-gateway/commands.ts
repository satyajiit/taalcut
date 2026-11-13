// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The five MCP_COMMANDS handlers (P3-V4), on the agent process's bus, each from core's `mcpCommandSpecs` (person
 * sources only: no agent, built in or external, turns MCP on, moves its port, raises a level or renames a session).
 * Every write goes through the command's unit of work (`settings.set(…, context)`), so the change and its audit row
 * commit together. A revoke also cancels the session's calls in flight and closes its external run at once; the
 * gateway re-reads the sessions after the commit, which is when the mcp process stops accepting the bearer. Adding a
 * session and rotating its hash are not commands (contract round P3-2): session-writes.ts, served as mcpSessions.
 */
import {
  defineCommand,
  MCP_COMMANDS,
  MCP_ENABLED_SETTING,
  MCP_PORT_SETTING,
  mcpCommandSpecs,
  ok,
  type AnyCommand,
  type Clock,
  type SettingsStore,
  type Telemetry,
} from '@taalcut/core';
import type { CallLedger } from './call-ledger';
import type { ExternalRunner } from './external-runner';
import { createSessionRecords } from './session-records';
import { createMcpSessionWrites, type McpSessionWrites } from './session-writes';
import type { McpSessionStore } from './sessions';

export interface McpCommandDeps {
  readonly settings: SettingsStore;
  readonly runner: ExternalRunner;
  readonly sessions: Pick<McpSessionStore, 'state'>;
  readonly ledger: Pick<CallLedger, 'abortSession' | 'forget'>;
  readonly clock: Clock;
  /** `mcp.sessionCreated` (client kind and level only), with the person's consent. */
  readonly telemetry?: Telemetry;
  readonly log?: (message: string) => void;
}

export interface McpCommands {
  readonly commands: AnyCommand[];
  /** Adding a session and rotating its hash: main's alone (session-writes.ts). */
  readonly writes: McpSessionWrites;
}

export function createMcpCommands(deps: McpCommandDeps): McpCommands {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const records = createSessionRecords({ settings: deps.settings, sessions: deps.sessions });
  const writes = createMcpSessionWrites({
    records,
    runner: deps.runner,
    ledger: deps.ledger,
    clock: deps.clock,
    ...(deps.telemetry ? { telemetry: deps.telemetry } : {}),
  });
  const commands: AnyCommand[] = [
    defineCommand({
      ...mcpCommandSpecs[MCP_COMMANDS.setEnabled],
      async handle({ enabled }, context) {
        const saved = await deps.settings.set(MCP_ENABLED_SETTING, enabled, context);
        return saved.ok ? ok({ result: { enabled } }) : saved;
      },
    }),
    defineCommand({
      ...mcpCommandSpecs[MCP_COMMANDS.setPort],
      async handle({ port }, context) {
        const before = await deps.settings.get(MCP_PORT_SETTING);
        if (!before.ok) return before;
        const saved = await deps.settings.set(MCP_PORT_SETTING, port, context);
        if (!saved.ok) return saved;
        return ok({
          result: { port },
          inverse: { name: MCP_COMMANDS.setPort, payload: { port: before.value } },
        });
      },
    }),
    defineCommand({
      ...mcpCommandSpecs[MCP_COMMANDS.setSessionLevel],
      handle: ({ sessionId, level }, context) =>
        records.update(
          sessionId,
          context,
          (record) => ({ ...record, level }),
          (before) => ({
            result: { sessionId, level },
            inverse: { name: MCP_COMMANDS.setSessionLevel, payload: { sessionId, level: before.level } },
          }),
        ),
    }),
    defineCommand({
      ...mcpCommandSpecs[MCP_COMMANDS.renameSession],
      handle: ({ sessionId, name }, context) =>
        records.update(
          sessionId,
          context,
          (record) => ({ ...record, name }),
          (before) => ({
            result: { sessionId, name },
            inverse: { name: MCP_COMMANDS.renameSession, payload: { sessionId, name: before.name } },
          }),
        ),
    }),
    defineCommand({
      ...mcpCommandSpecs[MCP_COMMANDS.revokeSession],
      async handle({ sessionId }, context) {
        const revoked = await records.update(
          sessionId,
          context,
          (record) => ({ ...record, revokedAt: deps.clock.now() }),
          (before) => ({ sessionId, runId: before.runId }),
        );
        if (!revoked.ok) return revoked;
        deps.ledger.abortSession(sessionId);
        deps.ledger.forget(sessionId);
        const closed = await deps.runner.close(revoked.value.runId, 'revoked');
        if (!closed.ok) log(`[mcp] run of revoked session not closed: ${closed.error.code}`);
        return ok({ result: { sessionId } });
      },
    }),
  ];
  return { commands, writes };
}
