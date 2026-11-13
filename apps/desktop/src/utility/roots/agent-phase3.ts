// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent process's Phase 3 namespaces (packages/core SPEC, "Phase 3 contract (round P3-1)").
 * Styles and hub are @taalcut/templates (agent-templates-hub.ts); mcp, mcpGateway and mcpSessions are served by
 * agent-mcp.ts.
 */
import type { Container } from '@taalcut/core';
import { templatesHubRouters } from './agent-templates-hub';

export function agentPhase3Routers(container: Container) {
  return {
    ...templatesHubRouters(container),
  };
}
