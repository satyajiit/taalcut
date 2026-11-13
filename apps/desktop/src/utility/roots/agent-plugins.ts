// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  PluginAgentServiceToken,
  type AnyCommand,
  type Container,
  type MainServicesClient,
  type PluginAgentService,
  type ToolModule,
} from '@taalcut/core';
import { createPluginCommands, pluginsToolModule } from '@taalcut/tools';
import { AgentMainServicesToken } from '../../shared/tokens';

/** Only non-secret operations cross this port; main owns the vault and authenticated transports. */
export function pluginServiceOverRpc(
  client: () => MainServicesClient<'agent'>['plugins'],
): PluginAgentService {
  return {
    list: () => callRpc(client().list()),
    describe: (pluginId) => callRpc(client().describe({ pluginId })),
    tools: (pluginId, signal) => callRpc(client().tools({ pluginId }, signal ? { signal } : {})),
    readSkill: (pluginId, skillId) => callRpc(client().readSkill({ pluginId, skillId })),
    configure: (input) => callRpc(client().configure(input)),
    setEnabled: (input) => callRpc(client().setEnabled(input)),
    setAccess: (input) => callRpc(client().setAccess(input)),
    disconnect: (pluginId) => callRpc(client().disconnect({ pluginId })),
    requestSetup: (pluginId) => callRpc(client().requestSetup({ pluginId })),
    testConnection: (pluginId, signal) =>
      callRpc(client().testConnection({ pluginId }, signal ? { signal } : {})),
    invoke: (input, signal) => callRpc(client().invoke(input, signal ? { signal } : {})),
  };
}

export function registerAgentPlugins(container: Container): void {
  if (!container.has(AgentMainServicesToken)) return;
  container.factory(PluginAgentServiceToken, ({ main }) => pluginServiceOverRpc(() => main().plugins), {
    deps: { main: AgentMainServicesToken },
  });
}

export function agentPluginTools(container: Container): ToolModule[] {
  return container.has(PluginAgentServiceToken)
    ? [pluginsToolModule(container.resolve(PluginAgentServiceToken))]
    : [];
}

export function agentPluginCommands(container: Container): AnyCommand[] {
  return container.has(PluginAgentServiceToken)
    ? createPluginCommands(container.resolve(PluginAgentServiceToken)).all
    : [];
}
