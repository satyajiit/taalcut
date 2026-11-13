// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app's language (P3-L2), as main resolves it: the preference (Automatic, or one of the four), what it
 * resolves to, and the Mac's own languages. Every window follows `locale.changed`, so a switch in one window, ⌘K,
 * the agent or an undo changes every window at once, without a restart.
 */
import {
  callRpc,
  SETTINGS_COMMANDS,
  type AppLocale,
  type LocalePreference,
  type LocaleState,
} from '@taalcut/core';
import { useHostPlatform } from '@taalcut/ui';
import { useEffect } from 'react';
import type { Backend } from '../backend/contract';
import { useBackend } from '../backend/backend';
import { useRpcStream, type Loadable } from '../backend/use-rpc';
import { activateLocale, i18n, pseudoOverride, storedLocale, storeLocale } from './i18n';
import { isAppLocale, type Locale } from './locales';

/** The language state, live. */
export function useLocaleState(): Loadable<LocaleState> {
  const backend = useBackend();
  return useRpcStream((signal) => backend.locale.changed(undefined, { signal }), [backend]);
}

/** Activates the resolved language whenever it changes (mounted once, at the app's root). */
export function LocaleSync() {
  const state = useLocaleState();
  const resolved = state.data?.resolved;
  const platform = useHostPlatform();
  useEffect(() => {
    // The pseudo-locale is the developer's override: the setting applies again once they leave it.
    if (!resolved || pseudoOverride() || resolved === i18n.locale) return;
    void activateLocale(resolved, platform);
  }, [resolved, platform]);
  return null;
}

/** The person's choice, as a command: app-wide, audited and undoable like the theme. */
export function setLocaleRequest(preference: LocalePreference) {
  return { name: SETTINGS_COMMANDS.setLocale, payload: { preference } } as const;
}

/**
 * The language to paint first, before the app renders (so nothing flashes English): the developer's
 * pseudo-locale when chosen, else what main resolved, else the stored choice. In Electron, a developer's earlier
 * choice in localStorage moves into the setting once (P3-L2).
 */
export async function initialLocale(backend: Backend, electron: boolean): Promise<Locale> {
  if (pseudoOverride()) return storedLocale();
  const state = await callRpc(backend.locale.state());
  if (!state.ok) return storedLocale();
  const stored = storedLocale();
  if (electron && state.value.preference === 'system' && isAppLocale(stored) && stored !== 'en') {
    const moved = await callRpc(backend.commands.dispatch({ ...setLocaleRequest(stored), source: 'ui' }));
    if (moved.ok) {
      storeLocale(null);
      return stored;
    }
  }
  return state.value.resolved;
}

/** "English", "हिन्दी": each language named in itself (the switcher sets `lang` on each). */
/* eslint-disable lingui/no-unlocalized-strings -- endonyms: the same words in every language, on purpose */
export const LANGUAGE_NAMES: Readonly<Record<AppLocale, string>> = {
  en: 'English',
  hi: 'हिन्दी',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
};
/* eslint-enable lingui/no-unlocalized-strings */
