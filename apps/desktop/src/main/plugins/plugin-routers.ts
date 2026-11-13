// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  implementContract,
  pluginsContract,
  pluginsServiceContract,
  pluginsSetupContract,
  unwrapRpc,
  type AsyncResult,
  type PluginService,
} from '@taalcut/core';
import { toWire } from '../../shared/wire';

const reply = async <T>(result: AsyncResult<T>) => toWire(unwrapRpc(await result));

export function pluginsRouter(service: PluginService) {
  const os = implementContract(pluginsContract);
  return os.router({
    list: os.list.handler(() => reply(service.list())),
    describe: os.describe.handler(({ input }) => reply(service.describe(input.pluginId))),
    tools: os.tools.handler(({ input, signal }) => reply(service.tools(input.pluginId, signal))),
    readSkill: os.readSkill.handler(({ input }) => reply(service.readSkill(input.pluginId, input.skillId))),
  });
}

/** This router is served only to the agent process, never to a window or an external MCP client. */
export function pluginsServiceRouter(service: PluginService) {
  const os = implementContract(pluginsServiceContract);
  return os.router({
    ...pluginsRouter(service),
    configure: os.configure.handler(({ input }) => reply(service.configure(input))),
    setEnabled: os.setEnabled.handler(({ input }) => reply(service.setEnabled(input))),
    setAccess: os.setAccess.handler(({ input }) => reply(service.setAccess(input))),
    disconnect: os.disconnect.handler(({ input }) => reply(service.disconnect(input.pluginId))),
    requestSetup: os.requestSetup.handler(({ input }) => reply(service.requestSetup(input.pluginId))),
    testConnection: os.testConnection.handler(({ input, signal }) =>
      reply(service.testConnection(input.pluginId, signal)),
    ),
    invoke: os.invoke.handler(({ input, signal }) => reply(service.invoke(input, signal))),
  });
}

export interface PluginClipboard {
  readText(): string | Promise<string>;
  clear(): void | Promise<void>;
}

export function pluginsSetupRouter(service: PluginService, clipboard: PluginClipboard) {
  const os = implementContract(pluginsSetupContract);
  return os.router({
    importCredential: os.importCredential.handler(async ({ input }) => {
      // Resolve the plugin before reading clipboard content; an unknown id never touches it.
      unwrapRpc(await service.describe(input.pluginId));
      const text = await clipboard.readText();
      const result = await service.importCredential(input.pluginId, input.credentialId, text);
      if (result.ok && (await clipboard.readText()) === text) await clipboard.clear();
      return reply(Promise.resolve(result));
    }),
    testConnection: os.testConnection.handler(({ input, signal }) =>
      reply(service.testConnection(input.pluginId, signal)),
    ),
  });
}
