// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's AGENT_SETTING_COMMANDS (C-17) as commands: each patches one app-wide setting from its payload and
 * undoes to the value it had before (the inverse is the same command with that value), so ⌘Z puts it back.
 * `agent.setSoulDials` (soul/soul-commands.ts) and `agent.setRouter` (router/router-commands.ts) differ only in
 * their setting, their sources and how a patch merges.
 */
import {
  defineCommand,
  ok,
  type AGENT_SETTING_COMMANDS,
  type CommandSource,
  type SettingDefinition,
  type SettingsStore,
} from '@taalcut/core';
import type { z } from 'zod';

type AgentSettingCommandName = (typeof AGENT_SETTING_COMMANDS)[keyof typeof AGENT_SETTING_COMMANDS];

export interface AgentSettingCommandSpec<N extends AgentSettingCommandName, P, V> {
  readonly name: N;
  /** Core's `agentSettingCommandPayloads[name]`. */
  readonly payload: z.ZodType<P>;
  readonly setting: SettingDefinition<V>;
  readonly sources: readonly CommandSource[];
  readonly settings: Pick<SettingsStore, 'get' | 'set'>;
  /** The new value: the patch's fields over the stored ones. */
  readonly merge: (before: V, patch: P) => V;
}

export function agentSettingCommand<N extends AgentSettingCommandName, P, V extends object>(
  spec: AgentSettingCommandSpec<N, P, V>,
) {
  return defineCommand({
    name: spec.name,
    payload: spec.payload,
    sideEffect: 'write',
    sources: spec.sources,
    project: () => null,
    async handle(patch, context) {
      const before = await spec.settings.get(spec.setting);
      if (!before.ok) return before;
      const saved = await spec.settings.set(spec.setting, spec.merge(before.value, patch), context);
      if (!saved.ok) return saved;
      return ok({
        result: saved.value,
        inverse: { name: spec.name, payload: { ...before.value, projectId: null } },
      });
    },
  });
}
