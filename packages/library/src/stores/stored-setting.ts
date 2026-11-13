// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A setting read straight from the library, for stores that need one synchronously: unset or unreadable is the default. */
import type { SettingDefinition } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createSettingsRepository } from '../repositories/settings';

export function storedSetting<T>(db: LibraryDatabase, setting: SettingDefinition<T>): T {
  const stored = createSettingsRepository(db).get(setting.key, setting.schema);
  return stored.ok && stored.value !== undefined ? stored.value : setting.defaultValue;
}
