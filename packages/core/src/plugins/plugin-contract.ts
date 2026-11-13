// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { ipc } from '../ipc/contract';
import { PLUGIN_COMMANDS, pluginCommandPayloads } from './plugin-commands';
import {
  pluginIdSchema,
  pluginInvokeSchema,
  pluginSkillContentSchema,
  pluginToolSchema,
  pluginViewSchema,
} from './plugin-types';

const identity = z.object({ pluginId: pluginIdSchema });
/** Public metadata only. Changes use the command bus; credential import has a separate main-only route. */
export const pluginsContract = {
  list: ipc.output(z.array(pluginViewSchema)),
  describe: ipc.input(identity).output(pluginViewSchema),
  tools: ipc.input(identity).output(z.array(pluginToolSchema)),
  readSkill: ipc.input(identity.extend({ skillId: pluginIdSchema })).output(pluginSkillContentSchema),
};
/** Available only on main's port to the agent process. */
export const pluginsServiceContract = {
  ...pluginsContract,
  configure: ipc.input(pluginCommandPayloads[PLUGIN_COMMANDS.configure]).output(pluginViewSchema),
  setEnabled: ipc.input(pluginCommandPayloads[PLUGIN_COMMANDS.setEnabled]).output(pluginViewSchema),
  setAccess: ipc.input(pluginCommandPayloads[PLUGIN_COMMANDS.setAccess]).output(pluginViewSchema),
  disconnect: ipc.input(identity).output(pluginViewSchema),
  requestSetup: ipc.input(identity).output(pluginViewSchema),
  testConnection: ipc.input(identity).output(pluginViewSchema),
  invoke: ipc.input(pluginInvokeSchema).output(z.unknown()),
};
/** The person copies an API key, then imports it. No key enters a window, chat, command payload or result. */
export const pluginsSetupContract = {
  importCredential: ipc.input(identity.extend({ credentialId: pluginIdSchema })).output(pluginViewSchema),
  testConnection: ipc.input(identity).output(pluginViewSchema),
};
