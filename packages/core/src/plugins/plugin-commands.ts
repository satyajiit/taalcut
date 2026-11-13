// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { PERSON_SOURCES } from '../commands/definition';
import { pluginConfigSchema, pluginIdSchema, pluginInvokeSchema } from './plugin-types';

export const PLUGIN_COMMANDS = {
  configure: 'plugins.configure',
  setEnabled: 'plugins.setEnabled',
  setAccess: 'plugins.setAccess',
  disconnect: 'plugins.disconnect',
  requestSetup: 'plugins.requestSetup',
  call: 'plugins.call',
} as const;
const identity = z.object({ pluginId: pluginIdSchema });
export const pluginCommandPayloads = {
  [PLUGIN_COMMANDS.configure]: identity.extend({ config: pluginConfigSchema }),
  [PLUGIN_COMMANDS.setEnabled]: identity.extend({ enabled: z.boolean() }),
  [PLUGIN_COMMANDS.setAccess]: identity.extend({ access: z.array(pluginIdSchema).max(100) }),
  [PLUGIN_COMMANDS.disconnect]: identity,
  [PLUGIN_COMMANDS.requestSetup]: identity,
  [PLUGIN_COMMANDS.call]: pluginInvokeSchema.extend({ mode: z.literal('external') }),
};
export const PLUGIN_PERSON_SOURCES = PERSON_SOURCES;
