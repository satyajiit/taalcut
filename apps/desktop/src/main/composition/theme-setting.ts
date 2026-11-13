// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where main's theme preference lives: core's THEME_SETTING in the
 * library's settings table. A window's choice is dispatched as
 * settings.setTheme on the bus (agent process), so it is audited and
 * undoable like any change; if the agent is down (starting or restarting)
 * main writes the setting itself. Every settings.setTheme from anywhere
 * (⌘K, the agent, undo, redo) comes back as command.changed, and main shows
 * the saved preference.
 *
 * IX3-F7 (F2): saves run one after another, in the order they were asked, so
 * an older choice never lands after a newer one. Main's own write tells the
 * watchers what is saved, as command.changed does for the agent's, and so does
 * a write that failed; the failure comes back to the caller as an error.
 */
import {
  callRpc,
  createSerialQueue,
  SETTINGS_COMMANDS,
  THEME_SETTING,
  ok,
  type AsyncResult,
  type EventBus,
  type SettingsStore,
  type ThemePreference,
} from '@taalcut/core';

export interface ThemeSettingDeps {
  readonly settings: SettingsStore;
  readonly events: EventBus;
  /** commands.dispatch on the agent process, as the user from the UI. */
  readonly dispatch: (preference: ThemePreference) => Promise<unknown>;
  readonly log?: (message: string) => void;
}

export interface ThemeSetting {
  /** The saved preference ('system' until there is one). */
  read(): AsyncResult<ThemePreference>;
  /** Err when neither the agent nor main could save it; the watchers have been shown what is saved. */
  save(preference: ThemePreference): AsyncResult<void>;
  /** Calls `apply` with the saved preference after every settings.setTheme, and after main's own writes. */
  watch(apply: (preference: ThemePreference) => void): () => void;
}

export function themeSetting(deps: ThemeSettingDeps): ThemeSetting {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const read = () => deps.settings.get(THEME_SETTING);
  const watchers = new Set<(preference: ThemePreference) => void>();
  const showSaved = async (to: Iterable<(preference: ThemePreference) => void>): Promise<void> => {
    const saved = await read();
    if (!saved.ok) return log(`[theme] ${saved.error.code}`);
    for (const apply of to) apply(saved.value);
  };

  const write = async (preference: ThemePreference): AsyncResult<void> => {
    const dispatched = await callRpc(deps.dispatch(preference));
    if (dispatched.ok) return ok(undefined);
    const saved = await deps.settings.set(THEME_SETTING, preference);
    if (!saved.ok) log(`[theme] not saved: ${saved.error.code}`);
    // No command, so no command.changed: tell the watchers here (IX3-F7, F2).
    await showSaved([...watchers]);
    return saved.ok ? ok(undefined) : saved;
  };
  const saves = createSerialQueue();

  return {
    read,
    // After the one before, however it ended (its caller has its answer).
    save: (preference) => saves.run(() => write(preference)),
    watch(apply) {
      watchers.add(apply);
      const stop = deps.events.on('command.changed', (event) => {
        if (event.payload.name === SETTINGS_COMMANDS.setTheme) void showSaved([apply]);
      });
      return () => {
        watchers.delete(apply);
        stop();
      };
    },
  };
}
