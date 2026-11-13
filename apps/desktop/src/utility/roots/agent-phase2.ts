// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent process's Phase 2 namespaces (packages/core SPEC, section 14).
 * Templates, timelines and acknowledgements are this process's. Budget,
 * privacy, onboarding, telemetry and debugBundle are the agent package's
 * routers (agent-services.ts). The library namespaces are library-agent.ts.
 * Telemetry records through core's TelemetryToken, which desktop registers.
 */
import { acknowledgementsRouter, AcknowledgementStoreToken, type Container } from '@taalcut/core';
import { agentServiceRouters } from './agent-services';
import { agentTemplatesRouter } from './agent-templates';
import { timelinesNamespace } from './agent-timeline';
import { libraryAgentRouters } from './library-agent';

export function agentPhase2Routers(container: Container) {
  return {
    // @taalcut/templates: served once the library registers TemplateStoreToken (agent-templates.ts).
    templates: agentTemplatesRouter(container),
    timelines: timelinesNamespace(container),
    acknowledgements: acknowledgementsRouter(container.resolve(AcknowledgementStoreToken)),
    // @taalcut/agent (P2-X1 budgets, P2-X2 privacy, P2-X4 onboarding, P2-X5 debug bundles, P2-X7 telemetry).
    ...agentServiceRouters(container),
    // @taalcut/library (P2-L1 to P2-L3, P2-X3): libraryRouter and projectsRouter.
    ...libraryAgentRouters(container),
  };
}
