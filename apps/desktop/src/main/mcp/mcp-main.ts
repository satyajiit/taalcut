// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's MCP wiring (P3-V4) in one place, so the composition files take one line each: the lifecycle on main's
 * container, the mcp process's connect config (its port) and fork options (a minimal environment), the setup
 * router every window is served, and the vault sweep after a revoke.
 */
import { join } from 'node:path';
import {
  callRpc,
  createToken,
  EventBusToken,
  ok,
  SettingsStoreToken,
  type AsyncResult,
  type Container,
  type RunId,
  type UtilityName,
} from '@taalcut/core';
import type { SecretStore } from '@taalcut/models';
import type { UtilityHost } from '../rpc/utility-host';
import { startMcpApprovalNotifications, type McpNotifier } from './approval-notify';
import type { SetupClipboard } from './clipboard-copy';
import { createMcpLifecycle, type McpLifecycle } from './mcp-lifecycle';
import { mcpSetupRouter } from './mcp-setup-router';
import { agentSessionHashes } from './session-hashes';
import { forgetRevokedTokens } from './tokens';

export const McpLifecycleToken = createToken<McpLifecycle>('desktop.mcpLifecycle');

/** Registers the lifecycle; `host` resolves lazily (the host's connect config reads the lifecycle's port). */
export function registerMcpMain(container: Container, host: () => Pick<UtilityHost, 'start' | 'stop'>): void {
  container.factory(
    McpLifecycleToken,
    ({ settings, events }) => createMcpLifecycle({ settings, events, host: host() }),
    {
      deps: { settings: SettingsStoreToken, events: EventBusToken },
      dispose: (lifecycle) => lifecycle.dispose(),
    },
  );
}

/** What the mcp process's connect message adds to the shared config. */
export function mcpConnectConfig(container: Container, process: UtilityName): { mcpPort?: number } {
  return process === 'mcp' ? { mcpPort: container.resolve(McpLifecycleToken).port() } : {};
}

/** The `taalcut` shim the stdio setup text names: the running app's own, or the repo's build in development. */
export function mcpShimPath(options: { packaged: boolean; resourcesPath: string; appPath: string }): string {
  return options.packaged
    ? join(options.resourcesPath, 'bin', 'taalcut')
    : join(options.appPath, '..', '..', 'native', 'taalcut-cli', 'dist', 'taalcut');
}

export interface McpMainDeps {
  readonly host: Pick<UtilityHost, 'client'>;
  readonly vault: SecretStore;
  readonly shimPath: string;
  readonly clipboard: SetupClipboard;
  /** System notifications for an external agent's approvals (approval-notify-electron.ts); none in tests. */
  readonly notifier?: McpNotifier;
}

/** The MCP session whose external run `runId` is, from the agent's MCP state. */
async function sessionOfRun(
  host: Pick<UtilityHost, 'client'>,
  runId: RunId,
): AsyncResult<{ readonly name: string } | undefined> {
  const state = await callRpc(host.client('agent').mcp.state());
  if (!state.ok) return state;
  const session = state.value.sessions.find((candidate) => candidate.runId === runId);
  return ok(session ? { name: session.name } : undefined);
}

/** Starts the lifecycle and the vault sweep; returns the setup router and a stop for quitting. */
export function startMcpMain(container: Container, deps: McpMainDeps) {
  const lifecycle = container.resolve(McpLifecycleToken);
  void lifecycle.start();
  const events = container.resolve(EventBusToken);
  const stopSweep = forgetRevokedTokens({
    events,
    settings: container.resolve(SettingsStoreToken),
    vault: deps.vault,
  });
  const router = mcpSetupRouter({
    vault: deps.vault,
    sessions: agentSessionHashes(() => deps.host.client('agent')),
    port: () => lifecycle.port(),
    shimPath: deps.shimPath,
    clipboard: deps.clipboard,
  });
  const stopNotifications = deps.notifier
    ? startMcpApprovalNotifications({
        ...deps.notifier,
        events,
        sessionOf: (runId) => sessionOfRun(deps.host, runId),
      })
    : () => undefined;
  return {
    router,
    stop: () => {
      stopSweep();
      stopNotifications();
    },
  };
}
