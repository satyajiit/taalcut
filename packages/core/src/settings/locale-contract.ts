// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app's language (P3-L2): a preference (the Mac's, or one of APP_LOCALES) kept in LOCALE_SETTING and changed
 * with `settings.setLocale`. appContract.locale, owner main: main reads the Mac's preferred languages, resolves the
 * preference (resolveLocale) and rebuilds its menus, as it does for the theme. ⌘K's `go.language` opens
 * Settings › About at Language.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { APP_LOCALES } from '../basics/locales';
import type { UiCommandName } from '../commands/ui-commands';
import { eventIterator, ipc } from '../ipc/contract';
import { defineSetting } from '../ports/preferences';

export const LOCALE_PREFERENCES = ['system', ...APP_LOCALES] as const;
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];
export const localePreferenceSchema = z.enum(LOCALE_PREFERENCES);
export const LOCALE_SETTING = defineSetting('ui.locale', localePreferenceSchema, 'system');

/** The UI command (⌘K "Change language…") that opens Settings › About at Language (in UI_COMMAND_NAMES). */
export const GO_LANGUAGE_COMMAND = 'go.language' satisfies UiCommandName;

export const localeStateSchema = z.object({
  preference: localePreferenceSchema,
  resolved: z.enum(APP_LOCALES),
  /** The Mac's preferred languages, for "Match the Mac (Español)". */
  system: z.array(z.string().max(35)).max(20),
});
export type LocaleState = z.output<typeof localeStateSchema>;

export const localeContract = {
  state: ipc.output(localeStateSchema),
  /** The current state first, then every change. */
  changed: ipc.output(eventIterator(localeStateSchema)),
};
