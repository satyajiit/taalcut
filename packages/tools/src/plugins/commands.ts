// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineCommand,
  ok,
  PLUGIN_COMMANDS,
  PLUGIN_PERSON_SOURCES,
  pluginCommandPayloads,
  type AnyCommand,
  type PluginAgentService,
} from '@taalcut/core';

/** The same commands back Settings, the built-in agent, and external agents. */
export function createPluginCommands(service: PluginAgentService): { readonly all: AnyCommand[] } {
  const person = { sideEffect: 'write', sources: PLUGIN_PERSON_SOURCES, project: () => null } as const;
  return {
    all: [
      defineCommand({
        ...person,
        name: PLUGIN_COMMANDS.configure,
        payload: pluginCommandPayloads[PLUGIN_COMMANDS.configure],
        async handle(input) {
          const result = await service.configure(input);
          return result.ok ? ok({ result: result.value }) : result;
        },
      }),
      defineCommand({
        ...person,
        name: PLUGIN_COMMANDS.setEnabled,
        payload: pluginCommandPayloads[PLUGIN_COMMANDS.setEnabled],
        async handle(input) {
          const result = await service.setEnabled(input);
          return result.ok ? ok({ result: result.value }) : result;
        },
      }),
      defineCommand({
        ...person,
        name: PLUGIN_COMMANDS.setAccess,
        payload: pluginCommandPayloads[PLUGIN_COMMANDS.setAccess],
        async handle(input) {
          const result = await service.setAccess(input);
          return result.ok ? ok({ result: result.value }) : result;
        },
      }),
      defineCommand({
        ...person,
        name: PLUGIN_COMMANDS.disconnect,
        payload: pluginCommandPayloads[PLUGIN_COMMANDS.disconnect],
        async handle({ pluginId }) {
          const result = await service.disconnect(pluginId);
          return result.ok ? ok({ result: result.value }) : result;
        },
      }),
      defineCommand({
        name: PLUGIN_COMMANDS.requestSetup,
        payload: pluginCommandPayloads[PLUGIN_COMMANDS.requestSetup],
        sideEffect: 'write',
        project: () => null,
        async handle({ pluginId }) {
          const result = await service.requestSetup(pluginId);
          return result.ok
            ? ok({ result: { plugin: result.value, detailsRoute: `/settings/plugins/${pluginId}` } })
            : result;
        },
      }),
      defineCommand({
        name: PLUGIN_COMMANDS.call,
        payload: pluginCommandPayloads[PLUGIN_COMMANDS.call],
        sideEffect: 'external',
        project: () => null,
        async handle(input, context) {
          const result = await service.invoke({
            ...input,
            idempotencyKey: input.idempotencyKey ?? `plugin-command:${context.commandId}`,
          });
          return result.ok ? ok({ result: result.value }) : result;
        },
      }),
    ],
  };
}
