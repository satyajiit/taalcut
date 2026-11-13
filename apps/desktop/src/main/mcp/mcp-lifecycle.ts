// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether the mcp process runs (D18: off by default). Main reads MCP_ENABLED_SETTING and MCP_PORT_SETTING at start
 * and after every `mcp.setEnabled` / `mcp.setPort` (command.changed, undo included): off stops the process, so the
 * port is closed; on starts it with the port in its connect config; a new port restarts it.
 */
import {
  createSerialQueue,
  MCP_COMMANDS,
  MCP_DEFAULT_PORT,
  MCP_ENABLED_SETTING,
  MCP_PORT_SETTING,
  type EventBus,
  type SettingsStore,
} from '@taalcut/core';
import type { UtilityHost } from '../rpc/utility-host';

export interface McpLifecycleDeps {
  readonly settings: Pick<SettingsStore, 'get'>;
  readonly events: Pick<EventBus, 'on'>;
  readonly host: Pick<UtilityHost, 'start' | 'stop'>;
  readonly log?: (message: string) => void;
}

export interface McpLifecycle {
  /** The port the process is (or would be) started with: its connect config reads it. */
  port(): number;
  /** Reads the settings and starts the process when MCP is on; then follows the commands. */
  start(): Promise<void>;
  dispose(): void;
}

const WATCHED: ReadonlySet<string> = new Set([MCP_COMMANDS.setEnabled, MCP_COMMANDS.setPort]);

export function createMcpLifecycle(deps: McpLifecycleDeps): McpLifecycle {
  const log = deps.log ?? ((message: string) => console.warn(message));
  let port = MCP_DEFAULT_PORT;
  let running = false;
  /** One apply at a time, in the order the changes came. */
  const applying = createSerialQueue();
  let off: (() => void) | undefined;

  const apply = async (): Promise<void> => {
    const enabled = await deps.settings.get(MCP_ENABLED_SETTING);
    const wanted = await deps.settings.get(MCP_PORT_SETTING);
    if (!enabled.ok || !wanted.ok) {
      log(
        `[mcp] settings not read: ${!enabled.ok ? enabled.error.code : !wanted.ok ? wanted.error.code : ''}`,
      );
      return;
    }
    const portChanged = wanted.value !== port;
    port = wanted.value;
    if (running && (!enabled.value || portChanged)) {
      await deps.host.stop('mcp');
      running = false;
    }
    if (enabled.value && !running) {
      deps.host.start('mcp');
      running = true;
    }
  };
  const schedule = (): Promise<void> => applying.run(apply);

  return {
    port: () => port,
    start() {
      off ??= deps.events.on('command.changed', (event) => {
        if (!WATCHED.has(event.payload.name)) return;
        // No one waits for a change a command asked for, so a start or stop that failed is logged here.
        void schedule().catch((cause: unknown) => log(`[mcp] change not applied: ${String(cause)}`));
      });
      return schedule();
    },
    dispose() {
      off?.();
      off = undefined;
    },
  };
}
