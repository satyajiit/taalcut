// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The external runner's port (P3-V4, platform request §24): the MCP gateway (`@taalcut/tools`' mcp-gateway)
 * defines it and calls it; the agent implements it (runner.ts). Re-exported here so the agent's modules and
 * its public API name one definition.
 */
export type {
  ExternalCallOptions,
  ExternalCallOutcome,
  ExternalRunHandle,
  ExternalRunner,
  ExternalRunSession,
  McpRequester,
} from '@taalcut/tools';

/** run.started's mark on an external run: who drives it. */
export interface ExternalRunInfo {
  sessionId: string;
  name: string;
  client: string;
}
