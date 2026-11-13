// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The MCP gateway (P3-V4), in the agent process: sessions, levels, exposure, calls through the external runner. */
export * from './errors';
export type {
  ExternalCallOptions,
  ExternalCallOutcome,
  ExternalRunHandle,
  ExternalRunner,
  ExternalRunSession,
  McpOrigin,
  McpRequester,
} from './external-runner';
export {
  createMcpGateway,
  MCP_APPROVAL_HOLD_MS,
  MCP_INSTRUCTIONS,
  MCP_PROGRESS_EVERY_MS,
  type McpGateway,
  type McpGatewayDeps,
  type McpGatewaySessions,
} from './gateway';
export { mcpGatewayRouter, mcpRouter, mcpSessionsRouter } from './gateway-router';
export { exposedTools, toMcpToolDef } from './exposure';
export { HIDDEN_FAMILIES, isExposed, levelAllows, levelNeeded } from './levels';
export { MCP_LAST_USED_SETTING } from './sessions';
export type { McpCallInput } from './call-flow';
