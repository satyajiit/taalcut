// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V4 in the agent process: @taalcut/tools' MCP gateway over this process's tool registry, command bus and
 * settings. Serves `mcp` (Settings › External agents), `mcpGateway` (the mcp process, through main) and
 * `mcpSessions` (main alone: a session's bearer hash) and registers the five MCP_COMMANDS on the bus. Each
 * session's calls run through the agent's external runner (@taalcut/agent's createExternalRunner on
 * ExternalRunnerToken, registered by roots/agent-external-runs.ts), looked up when used, so the order of
 * registration doesn't matter. A container without one (a test's) answers core.not_implemented (feature
 * agent.externalRunner) instead of failing to compose.
 */
import {
  ClockToken,
  CommandBusToken,
  createToken,
  err,
  NotImplementedError,
  SettingsStoreToken,
  TelemetryToken,
  type AnyCommand,
  type AsyncResult,
  type Container,
} from '@taalcut/core';
import {
  createMcpGateway,
  mcpGatewayRouter,
  mcpRouter,
  mcpSessionsRouter,
  type ExternalRunner,
  type McpGateway,
} from '@taalcut/tools';
import { ExternalRunnerToken, ToolRegistryToken } from '../../shared/tokens';

export const McpGatewayToken = createToken<McpGateway>('desktop.mcpGateway');

/** The registered runner, read on each use; core.not_implemented while there is none. */
function lookedUpRunner(container: Container): ExternalRunner {
  const missing = (): AsyncResult<never> =>
    Promise.resolve(err(NotImplementedError({ feature: 'agent.externalRunner' })));
  const runner = (): ExternalRunner | undefined =>
    container.has(ExternalRunnerToken) ? container.resolve(ExternalRunnerToken) : undefined;
  return {
    open: (session) => runner()?.open(session) ?? missing(),
    call: (runId, name, input, options) => runner()?.call(runId, name, input, options) ?? missing(),
    close: (runId, reason) => runner()?.close(runId, reason) ?? missing(),
  };
}

export function registerAgentMcp(container: Container): void {
  container.factory(
    McpGatewayToken,
    ({ registry, bus, settings, clock }) =>
      createMcpGateway({
        registry,
        runner: lookedUpRunner(container),
        bus,
        settings,
        clock,
        // Read at record time: the telemetry service is bound after the commands are registered.
        telemetry: {
          record: (event) => {
            if (container.has(TelemetryToken)) container.resolve(TelemetryToken).record(event);
          },
        },
      }),
    {
      deps: {
        registry: ToolRegistryToken,
        bus: CommandBusToken,
        settings: SettingsStoreToken,
        clock: ClockToken,
      },
      dispose: (gateway) => gateway.dispose(),
    },
  );
}

/** MCP_COMMANDS' handlers, for the bus. */
export function agentMcpCommands(container: Container): AnyCommand[] {
  return container.resolve(McpGatewayToken).commands;
}

export function agentMcpRouters(container: Container) {
  const gateway = container.resolve(McpGatewayToken);
  return {
    mcp: mcpRouter(gateway),
    mcpGateway: mcpGatewayRouter(gateway),
    mcpSessions: mcpSessionsRouter(gateway),
  };
}

/** Reads the sessions and the switch, and follows MCP commands from now on. */
export async function startAgentMcp(container: Container): Promise<void> {
  const started = await container.resolve(McpGatewayToken).start();
  if (!started.ok) console.warn(`[mcp] gateway not started: ${started.error.code}`);
}
