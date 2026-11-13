// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `agent.setSoulDials` (core's AGENT_SETTING_COMMANDS, SPEC section 22): the tone and verbosity dials,
 * app-wide. A write with the previous dials as its inverse, so ⌘Z puts them back. Settings → Agent, the
 * composer's dial menu and shortcuts dispatch it; so does the agent's `soul.setDials` tool when the user asks
 * for a lasting change. MCP clients can't (the persona is the person's). The new dials apply from the next
 * run: a run's prompt is fixed when it starts.
 */
import {
  AGENT_SETTING_COMMANDS,
  agentSettingCommandPayloads,
  SOUL_DIALS_SETTING,
  type CommandSource,
  type SettingsStore,
} from '@taalcut/core';
import { agentSettingCommand } from '../settings/agent-setting-command';

/** The person's own sources, and the agent when they asked it to change the dials. */
export const SOUL_DIAL_SOURCES = ['ui', 'shortcut', 'agent'] as const satisfies readonly CommandSource[];

export interface SoulCommandDeps {
  readonly settings: Pick<SettingsStore, 'get' | 'set'>;
}

export function createSoulCommands(deps: SoulCommandDeps) {
  const setSoulDials = agentSettingCommand({
    name: AGENT_SETTING_COMMANDS.setSoulDials,
    payload: agentSettingCommandPayloads[AGENT_SETTING_COMMANDS.setSoulDials],
    setting: SOUL_DIALS_SETTING,
    sources: SOUL_DIAL_SOURCES,
    settings: deps.settings,
    merge: (before, { tone, verbosity }) => ({
      tone: tone ?? before.tone,
      verbosity: verbosity ?? before.verbosity,
    }),
  });
  return { setSoulDials, all: [setSoulDials] };
}
