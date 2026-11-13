// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `privacy.localOnly` as stock reads it, before any request. Unset is the
 * setting's default (off). A stored value that can't be read counts as on, like
 * the agent's Local-only flag: a broken setting must not open the network.
 */
import { LOCAL_ONLY_SETTING } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createSettingsRepository } from '../repositories/settings';

export function readLocalOnly(db: LibraryDatabase): boolean {
  const stored = createSettingsRepository(db).get(LOCAL_ONLY_SETTING.key, LOCAL_ONLY_SETTING.schema);
  if (!stored.ok) return true;
  return stored.value ?? LOCAL_ONLY_SETTING.defaultValue;
}
