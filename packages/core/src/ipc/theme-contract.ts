// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The theme contract, which replaced the raw 'theme:get' / 'theme:set' /
 * 'theme:changed' channels (DESIGN.md, "Theme engine"). Main implements it
 * with themeRouter: it owns nativeTheme and the saved preference.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { THEME_PREFERENCES, type ThemePreference, type ThemeState } from '../basics/theme';
import { eventIterator, implementContract, ipc } from './contract';
import { latestValues } from './iterators';

export const themePreferenceSchema = z.enum(THEME_PREFERENCES);
export const resolvedThemeSchema = z.enum(['light', 'dark']);
export const themeStateSchema: z.ZodType<ThemeState> = z.object({
  preference: themePreferenceSchema,
  resolved: resolvedThemeSchema,
});

export const themeContract = {
  /** The saved preference and what it resolves to right now. */
  get: ipc.output(themeStateSchema),
  /** Saves a preference (main validates it) and returns the new state. */
  set: ipc.input(z.object({ preference: themePreferenceSchema })).output(themeStateSchema),
  /** The current state first, then every change (any window, the menu, ⌘K, or macOS on System). */
  changed: ipc.output(eventIterator(themeStateSchema)),
};

/** The theme as main sees it, minus Electron (main adapts nativeTheme to this). */
export interface ThemeService {
  get(): ThemeState;
  /** Saves and applies a preference; returns the new state. */
  set(preference: ThemePreference): ThemeState | Promise<ThemeState>;
  /** Every state change, whatever caused it. Returns an unsubscribe function. */
  subscribe(listener: (state: ThemeState) => void): () => void;
}

export function themeRouter(theme: ThemeService) {
  const os = implementContract(themeContract);
  return os.router({
    get: os.get.handler(() => theme.get()),
    set: os.set.handler(async ({ input }) => theme.set(input.preference)),
    changed: os.changed.handler(({ signal }) =>
      latestValues(
        () => theme.get(),
        (listener) => theme.subscribe(listener),
        signal,
      ),
    ),
  });
}
