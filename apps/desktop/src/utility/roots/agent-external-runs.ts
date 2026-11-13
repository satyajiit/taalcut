// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V4 in the agent process: the external runner the MCP gateway runs a session's tool calls through
 * (@taalcut/agent's createExternalRunner over this process's agent), on the shared ExternalRunnerToken that the
 * mcp-release lane's gateway wiring reads. Each session gets one external run in its own conversation; Local only is read as it is now.
 */
import { ConversationStoreToken, type Container } from '@taalcut/core';
import { createExternalRunner } from '@taalcut/agent';
import { ExternalRunnerToken } from '../../shared/tokens';
import { LocalOnlyFlagToken } from './agent-flows';
import { AgentToken } from './agent-loop';

export function registerExternalRuns(container: Container): void {
  container.factory(
    ExternalRunnerToken,
    ({ agent, conversations }) =>
      createExternalRunner({
        host: agent.external(),
        conversations,
        ...(container.has(LocalOnlyFlagToken)
          ? { localOnly: () => container.resolve(LocalOnlyFlagToken).get() }
          : {}),
      }),
    { deps: { agent: AgentToken, conversations: ConversationStoreToken } },
  );
}
