// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `agent.setRouter` (core's AGENT_SETTING_COMMANDS, C-17): the router's rollout, app-wide, person sources
 * only (the agent and MCP clients are refused by the bus), undoable (the inverse puts the previous setting
 * back). The report recommends; a person flips it, writing `gate` from a passing report. A family set `live`
 * without a gate stays in shadow (gate.ts), so this command never forces routing on by itself.
 */
import {
  AGENT_SETTING_COMMANDS,
  agentSettingCommandPayloads,
  PERSON_SOURCES,
  ROUTER_SETTING,
  type SettingsStore,
} from '@taalcut/core';
import { agentSettingCommand } from '../settings/agent-setting-command';

export interface RouterCommandDeps {
  readonly settings: Pick<SettingsStore, 'get' | 'set'>;
}

export function createRouterCommands(deps: RouterCommandDeps) {
  const setRouter = agentSettingCommand({
    name: AGENT_SETTING_COMMANDS.setRouter,
    payload: agentSettingCommandPayloads[AGENT_SETTING_COMMANDS.setRouter],
    setting: ROUTER_SETTING,
    sources: PERSON_SOURCES,
    settings: deps.settings,
    merge: (before, { mode, families, noneLive, gate }) => ({
      mode: mode ?? before.mode,
      families: families ?? before.families,
      noneLive: noneLive ?? before.noneLive,
      gate: gate === undefined ? before.gate : gate,
    }),
  });
  return { setRouter, all: [setRouter] };
}
