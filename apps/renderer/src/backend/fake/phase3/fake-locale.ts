// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app's language as main serves it (P3-L2, appContract.locale): the preference in core's LOCALE_SETTING,
 * changed by core's own `settings.setLocale` on the fake's bus. Automatic selection uses English in this beta,
 * exactly as main does. Every change is pushed to `locale.changed`.
 */
import {
  LOCALE_PREFERENCES,
  LOCALE_SETTING,
  type LocalePreference,
  type LocaleState,
  type SettingsStore,
} from '@taalcut/core';
import { watched, type Watched } from '../watch';

export interface FakeLocaleOptions {
  /** The Mac's preferred languages, in order (Electron's app.getPreferredSystemLanguages()). */
  readonly system?: readonly string[];
  /** A preference saved before this launch. Default: 'system'. */
  readonly preference?: LocalePreference;
  /** Called after each change, to keep the preference across reloads of the preview. */
  readonly persist?: (preference: LocalePreference) => void;
}

export interface FakeLocale {
  readonly watch: Watched<LocaleState>;
  /** Re-reads the setting after a settings.setLocale (or its undo). */
  refresh(): Promise<void>;
}

export const isLocalePreference = (value: unknown): value is LocalePreference =>
  typeof value === 'string' && (LOCALE_PREFERENCES as readonly string[]).includes(value);

const stateOf = (preference: LocalePreference, system: readonly string[]): LocaleState => ({
  preference,
  resolved: preference === 'system' ? 'en' : preference,
  system: [...system],
});

export function createFakeLocale(settings: SettingsStore, options: FakeLocaleOptions = {}): FakeLocale {
  const system = (options.system ?? ['en-US']).slice(0, 20);
  let current = stateOf(options.preference ?? 'system', system);
  // What was saved before this launch is in the store, so undo after a switch goes back to it.
  if (options.preference && options.preference !== 'system')
    void settings.set(LOCALE_SETTING, options.preference);
  const watch = watched(() => current);
  return {
    watch,
    async refresh() {
      const saved = await settings.get(LOCALE_SETTING);
      if (!saved.ok) return;
      current = stateOf(saved.value, system);
      options.persist?.(saved.value);
      watch.notify();
    },
  };
}
