// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The clips open in the app's windows, whose files the media cache keeps (UX2 round 4; library SPEC "UX2: the
 * cache's cap"). Main keeps the list: it owns the windows and sees which clip page each one shows, so the list
 * outlives the jobs process. Main writes it here on every change, and the jobs process reads it each time the cache
 * is about to delete a file (cache-holds.ts), so a jobs process that restarts has the list before it runs anything,
 * with nothing to hand over and nothing to wait for. Main writes an empty list when it starts: no window is open yet,
 * and a list a crash left behind holds nothing.
 */
import { defineSetting, err, idSchema, ok, ValidationError, type AssetId, type Result } from '@taalcut/core';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { createSettingsRepository } from '../repositories/settings';

/** One clip per window: far more than anyone has open. */
export const OPEN_CLIPS_MAX = 200;

export const OPEN_CLIPS_SETTING = defineSetting(
  'library.openClips',
  z.array(idSchema<'Asset'>()).max(OPEN_CLIPS_MAX),
  [],
);

/** The clips open now (none when main never wrote the list). A list that no longer parses is an error. */
export function openClips(db: LibraryDatabase): Result<ReadonlySet<AssetId>> {
  const stored = createSettingsRepository(db).get(OPEN_CLIPS_SETTING.key, OPEN_CLIPS_SETTING.schema);
  return stored.ok ? ok(new Set(stored.value ?? OPEN_CLIPS_SETTING.defaultValue)) : stored;
}

/** Main's write: these clips are open now, and no others. */
export function saveOpenClips(db: LibraryDatabase, assetIds: readonly AssetId[]): Result<void> {
  const parsed = OPEN_CLIPS_SETTING.schema.safeParse([...new Set(assetIds)]);
  if (!parsed.success)
    return err(ValidationError({ field: OPEN_CLIPS_SETTING.key }, { detail: parsed.error.message }));
  return createSettingsRepository(db).set(OPEN_CLIPS_SETTING.key, parsed.data);
}
