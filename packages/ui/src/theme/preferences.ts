// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ThemePreference } from '@taalcut/core';

/**
 * The three choices, in the order the switcher shows them.
 *
 * packages/ui may import only types from core (dependency-cruiser,
 * `ui-imports-core-types-only`), so the runtime list is restated here. The
 * check below fails to compile if core's ThemePreference gains or loses a value.
 */
export const THEME_OPTIONS = ['system', 'light', 'dark'] as const satisfies readonly ThemePreference[];

type MissingOption = Exclude<ThemePreference, (typeof THEME_OPTIONS)[number]>;
const everyPreferenceListed: MissingOption extends never ? true : MissingOption = true;
void everyPreferenceListed;

/** Where web pages and the browser build keep the choice. web-boot.js reads the same key. */
export const THEME_STORAGE_KEY = 'taalcut.theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_OPTIONS as readonly string[]).includes(value);
}
