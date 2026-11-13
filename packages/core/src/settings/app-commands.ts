// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * App-wide settings commands, registered on the bus in the agent process.
 *
 * - settings.setTheme: the theme preference lives in the SettingsStore
 *   (THEME_SETTING); main applies it to nativeTheme at start and on every
 *   command.changed for this command, so Settings, ⌘K, the agent and undo
 *   all go through one path.
 * - settings.setLocale (P3-L2): the app's language preference
 *   (LOCALE_SETTING), the same way; main re-reads it on command.changed.
 * - settings.openSignInWarning: the fix on models.acknowledgement_required.
 *   Opening a card is the renderer's job, so it emits `ui.action` and
 *   changes nothing (read: not audited).
 * - settings.openAccounts and settings.openModels: the fixes "Open Accounts"
 *   and "Open Models" on models' errors (a model not set up or signed out, a
 *   download that failed). They open that page the same way.
 * - Removed in HFW1 (retire): settings.setMotionDesign, the Motion design
 *   switch: it gated the kit's motion graphics, and a graphic is now a
 *   composition the AI designs.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ok } from '../basics/result';
import { themePreferenceSchema } from '../ipc/theme-contract';
import { defineCommand } from '../commands/definition';
import type { EventBus } from '../events/bus';
import { defineSetting, type SettingsStore } from '../ports/preferences';
import { LOCALE_SETTING, localePreferenceSchema } from './locale-contract';
import { createInterfaceSoundsCommands, INTERFACE_SOUNDS_COMMANDS } from './interface-sounds';

export const THEME_SETTING = defineSetting('appearance.theme', themePreferenceSchema, 'system');

export const SETTINGS_COMMANDS = {
  ...INTERFACE_SOUNDS_COMMANDS,
  setTheme: 'settings.setTheme',
  setLocale: 'settings.setLocale',
  openSignInWarning: 'settings.openSignInWarning',
  openAccounts: 'settings.openAccounts',
  openModels: 'settings.openModels',
} as const;

export function createSettingsCommands(deps: {
  readonly settings: SettingsStore;
  readonly events: EventBus;
}) {
  const sounds = createInterfaceSoundsCommands(deps.settings);
  const setTheme = defineCommand({
    name: SETTINGS_COMMANDS.setTheme,
    payload: z.object({ preference: themePreferenceSchema }),
    sideEffect: 'write',
    project: () => null,
    async handle({ preference }, context) {
      const before = await deps.settings.get(THEME_SETTING);
      if (!before.ok) return before;
      // Commits with this command's audit row (undo and redo too), not before it.
      const saved = await deps.settings.set(THEME_SETTING, preference, context);
      if (!saved.ok) return saved;
      return ok({
        result: { preference },
        inverse: { name: SETTINGS_COMMANDS.setTheme, payload: { preference: before.value } },
      });
    },
  });

  const setLocale = defineCommand({
    name: SETTINGS_COMMANDS.setLocale,
    payload: z.object({ preference: localePreferenceSchema }),
    sideEffect: 'write',
    project: () => null,
    async handle({ preference }, context) {
      const before = await deps.settings.get(LOCALE_SETTING);
      if (!before.ok) return before;
      const saved = await deps.settings.set(LOCALE_SETTING, preference, context);
      if (!saved.ok) return saved;
      return ok({
        result: { preference },
        inverse: { name: SETTINGS_COMMANDS.setLocale, payload: { preference: before.value } },
      });
    },
  });

  const openSignInWarning = defineCommand({
    name: SETTINGS_COMMANDS.openSignInWarning,
    payload: z.object({ feature: z.string().min(1).max(100), termsVersion: z.string().min(1).max(100) }),
    sideEffect: 'read',
    project: () => null,
    handle({ feature, termsVersion }) {
      deps.events.emit('ui.action', {
        action: SETTINGS_COMMANDS.openSignInWarning,
        args: { feature, termsVersion },
      });
      return ok({ result: null });
    },
  });

  /** Asks the window to open a page; changes nothing. A fix sends no payload, so the schema is an empty object. */
  const openPage = (name: typeof SETTINGS_COMMANDS.openAccounts | typeof SETTINGS_COMMANDS.openModels) =>
    defineCommand({
      name,
      payload: z.object({}),
      sideEffect: 'read',
      project: () => null,
      handle() {
        deps.events.emit('ui.action', { action: name });
        return ok({ result: null });
      },
    });
  const openAccounts = openPage(SETTINGS_COMMANDS.openAccounts);
  const openModels = openPage(SETTINGS_COMMANDS.openModels);

  return {
    ...sounds,
    setTheme,
    setLocale,
    openSignInWarning,
    openAccounts,
    openModels,
    all: [setTheme, setLocale, openSignInWarning, openAccounts, openModels, ...sounds.all],
  };
}
