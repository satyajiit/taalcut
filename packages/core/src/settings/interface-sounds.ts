// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { ok } from '../basics/result';
import { defineCommand } from '../commands/definition';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import { defineSetting, type SettingsStore } from '../ports/preferences';

export const interfaceSoundsStateSchema = z.object({ enabled: z.boolean(), initialized: z.boolean() });
export type InterfaceSoundsState = z.output<typeof interfaceSoundsStateSchema>;

/** The marker keeps a legacy renderer preference from replacing a choice already saved by another window. */
export const INTERFACE_SOUNDS_SETTING = defineSetting('ui.interfaceSounds', interfaceSoundsStateSchema, {
  enabled: true,
  initialized: false,
});

export const INTERFACE_SOUNDS_COMMANDS = {
  setInterfaceSounds: 'settings.setInterfaceSounds',
  initializeInterfaceSounds: 'settings.initializeInterfaceSounds',
} as const;

export const interfaceSoundsContract = { state: ipc.output(interfaceSoundsStateSchema) };

export function interfaceSoundsRouter(settings: Pick<SettingsStore, 'get'>) {
  const os = implementContract(interfaceSoundsContract);
  return os.router({
    state: os.state.handler(async () => unwrapRpc(await settings.get(INTERFACE_SOUNDS_SETTING))),
  });
}

/** App-wide commands share the bus's null-project queue, including the conditional legacy migration. */
export function createInterfaceSoundsCommands(settings: SettingsStore) {
  const payload = z.object({ enabled: z.boolean() });
  const setInterfaceSounds = defineCommand({
    name: INTERFACE_SOUNDS_COMMANDS.setInterfaceSounds,
    payload,
    sideEffect: 'write',
    project: () => null,
    async handle({ enabled }, context) {
      const before = await settings.get(INTERFACE_SOUNDS_SETTING);
      if (!before.ok) return before;
      const saved = await settings.set(INTERFACE_SOUNDS_SETTING, { enabled, initialized: true }, context);
      if (!saved.ok) return saved;
      return ok({
        result: saved.value,
        inverse: {
          name: INTERFACE_SOUNDS_COMMANDS.setInterfaceSounds,
          payload: { enabled: before.value.enabled },
        },
      });
    },
  });
  const initializeInterfaceSounds = defineCommand({
    name: INTERFACE_SOUNDS_COMMANDS.initializeInterfaceSounds,
    payload,
    sideEffect: 'write',
    project: () => null,
    async handle({ enabled }, context) {
      const before = await settings.get(INTERFACE_SOUNDS_SETTING);
      if (!before.ok) return before;
      if (before.value.initialized) return ok({ result: before.value });
      const saved = await settings.set(INTERFACE_SOUNDS_SETTING, { enabled, initialized: true }, context);
      return saved.ok ? ok({ result: saved.value }) : saved;
    },
  });
  return {
    setInterfaceSounds,
    initializeInterfaceSounds,
    all: [setInterfaceSounds, initializeInterfaceSounds],
  };
}
