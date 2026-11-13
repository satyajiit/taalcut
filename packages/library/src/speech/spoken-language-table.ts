// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The Drizzle table for a clip's spoken language (LIB1-LANG, migration 35). JSON is read back through core's schema. */
import type { AssetId } from '@taalcut/core';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { assets } from '../schema/library';

export const assetSpokenLanguage = sqliteTable('asset_spoken_language', {
  assetId: text('asset_id')
    .$type<AssetId>()
    .primaryKey()
    .references(() => assets.id, { onDelete: 'cascade' }),
  /** core's SpokenLanguageOutcome, from audio.language; null before it ran. */
  outcome: text('outcome', { mode: 'json' }).$type<unknown>(),
  /** The language the person set (BCP 47); null: detection decides. */
  chosen: text('chosen'),
  chosenAt: integer('chosen_at'),
  updatedAt: integer('updated_at').notNull(),
});
