// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What Settings › External agents reads (core's McpState): whether MCP is on, the local server's status as the
 * mcp process last reported it, and every session as a view without its token hash. A server status is only
 * believed while MCP is on and for the port it was reported on; otherwise the state says off or starting.
 */
import type { McpServerStatus, McpSessionView, McpState } from '@taalcut/core';
import type { CallLedger } from './call-ledger';
import type { McpSessionStore } from './sessions';

export interface McpSwitch {
  readonly enabled: boolean;
  readonly port: number;
}

/** The server's status for Settings, given the switch and the last report. */
export function serverStatus(switched: McpSwitch, reported: McpServerStatus | undefined): McpServerStatus {
  if (!switched.enabled) return { state: 'off', port: switched.port };
  if (!reported || reported.port !== switched.port || reported.state === 'off')
    return { state: 'starting', port: switched.port };
  return reported;
}

const MAX_VIEWS = 64;

export function sessionViews(
  sessions: Pick<McpSessionStore, 'records' | 'state'>,
  ledger: Pick<CallLedger, 'callsToday' | 'pendingApprovals'>,
): McpSessionView[] {
  return sessions
    .records()
    .slice(0, MAX_VIEWS)
    .map((record) => {
      const { tokenHash: _secret, ...rest } = record;
      return {
        ...rest,
        status: sessions.state(record),
        callsToday: ledger.callsToday(record.id),
        pendingApprovals: ledger.pendingApprovals(record.id),
      };
    });
}

export function mcpState(
  switched: McpSwitch,
  reported: McpServerStatus | undefined,
  sessions: Pick<McpSessionStore, 'records' | 'state'>,
  ledger: Pick<CallLedger, 'callsToday' | 'pendingApprovals'>,
): McpState {
  return {
    enabled: switched.enabled,
    server: serverStatus(switched, reported),
    sessions: sessionViews(sessions, ledger),
  };
}
