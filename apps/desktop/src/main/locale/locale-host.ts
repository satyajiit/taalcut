// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app's language in main (P3-L2): the preference in core's LOCALE_SETTING (the library's settings table),
 * resolved to English for automatic selection in this beta, served to every window as
 * `appContract.locale`. `settings.setLocale` runs on the agent's bus (audited, undoable); every one, from any
 * window, ⌘K, the agent or undo, comes back as command.changed, and main re-reads the setting and tells every
 * window and its own menu. Replaces the contract round's not-served stand-in.
 */
import {
  implementContract,
  latestValues,
  LOCALE_SETTING,
  localeContract,
  SETTINGS_COMMANDS,
  type EventBus,
  type LocalePreference,
  type LocaleState,
  type SettingsStore,
} from '@taalcut/core';

export interface LocaleHostDeps {
  readonly settings: Pick<SettingsStore, 'get'>;
  readonly events: Pick<EventBus, 'on'>;
  /** The Mac's preferred languages, in order (app.getPreferredSystemLanguages()). */
  readonly preferred: () => readonly string[];
  readonly log?: (message: string) => void;
}

export interface LocaleHost {
  current(): LocaleState;
  /** Every change; returns the unsubscribe function. */
  subscribe(listener: (state: LocaleState) => void): () => void;
  stop(): void;
}

export function localeState(preference: LocalePreference, preferred: readonly string[]): LocaleState {
  const system = preferred.slice(0, 20).map((tag) => tag.slice(0, 35));
  return {
    preference,
    // Draft catalogues are contributor previews: only an explicit choice activates them in this beta.
    resolved: preference === 'system' ? 'en' : preference,
    system,
  };
}

/** Reads the saved preference once (Automatic until there is one), then follows every settings.setLocale. */
export async function createLocaleHost(deps: LocaleHostDeps): Promise<LocaleHost> {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const read = async (): Promise<LocalePreference> => {
    const saved = await deps.settings.get(LOCALE_SETTING);
    if (saved.ok) return saved.value;
    log(`[locale] not read: ${saved.error.code}`);
    return 'system';
  };
  let state = localeState(await read(), deps.preferred());
  const listeners = new Set<(state: LocaleState) => void>();
  const stop = deps.events.on('command.changed', (event) => {
    if (event.payload.name !== SETTINGS_COMMANDS.setLocale) return;
    void read().then((preference) => {
      state = localeState(preference, deps.preferred());
      for (const listener of listeners) listener(state);
    });
  });
  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop,
  };
}

/** appContract.locale over the host: the state, and the current one then every change. */
export function localeRouter(host: Pick<LocaleHost, 'current' | 'subscribe'>) {
  const os = implementContract(localeContract);
  return os.router({
    state: os.state.handler(() => host.current()),
    changed: os.changed.handler(({ signal }) => latestValues(host.current, host.subscribe, signal)),
  });
}
