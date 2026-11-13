// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The mcp process (P3-V4, D18): the local MCP server and nothing else. It parses untrusted HTTP on a loopback port,
 * so it gets the LAN server's treatment: no database handle (no library container here), no keys, no tools, its
 * own process that can die alone. Sessions, tool lists and calls come from the agent's gateway through main
 * (MAIN_SERVICE_CONTRACTS.mcp.gateway). A port that is taken is reported to Settings and the process stays up
 * without listening; main restarts it when the person picks another port.
 */
import { join } from 'node:path';
import {
  ClockToken,
  connectRpc,
  createContainer,
  createEventBus,
  createToken,
  EventBusToken,
  implementContract,
  MAIN_SERVICE_CONTRACTS,
  MCP_DEFAULT_PORT,
  systemClock,
  UTILITY_CONTRACTS,
  type PortLike,
} from '@taalcut/core';
import { createMcpServerHost, type McpServerHost } from '@taalcut/tools';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { UtilityConfigToken } from '../../shared/tokens';
import type { UtilityRoot } from '../runtime';
import { commonRouters } from './base';

export const McpServerHostToken = createToken<McpServerHost>('desktop.mcpServerHost');

/** Where the `taalcut mcp` shim looks for the server when its configuration names no URL. */
export function mcpEndpointFile(userData: string): string {
  return join(userData, 'mcp', 'endpoint.json');
}

export function composeMcp(
  config: UtilityConfig,
  main: PortLike | undefined,
  pid: number = process.pid,
): UtilityRoot {
  if (!main) throw new Error('The mcp process needs the port to main’s services.');
  const container = createContainer();
  container.value(UtilityConfigToken, config);
  container.value(ClockToken, systemClock);
  container.factory(EventBusToken, ({ clock }) => createEventBus({ clock }), { deps: { clock: ClockToken } });
  const services = connectRpc(MAIN_SERVICE_CONTRACTS.mcp, main, { peer: 'main' });
  container.factory(
    McpServerHostToken,
    ({ clock }) =>
      createMcpServerHost({
        gateway: services.client.gateway,
        port: config.mcpPort ?? MCP_DEFAULT_PORT,
        clock,
        version: config.appVersion?.trim() || '0.0.0',
        endpointFile: mcpEndpointFile(config.userData),
        pid,
        log: (line) => console.warn(line),
      }),
    { deps: { clock: ClockToken }, dispose: (host) => host.stop() },
  );
  const os = implementContract(UTILITY_CONTRACTS.mcp);
  return {
    container,
    router: os.router(commonRouters(container, 'mcp', pid)),
    async start() {
      const started = await container.resolve(McpServerHostToken).start();
      // Reported to the gateway already (Settings shows it); staying up keeps the supervisor from looping.
      if (!started.ok) console.warn(`[mcp] not listening: ${started.error.code}`);
    },
  };
}
