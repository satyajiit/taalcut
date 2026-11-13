// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 33 (LIB1-OEM): a zone a clip borrowed from the clip nearest in time from a source they share, when
 * its own file names none (repositories/capture-offsets.ts). Written with raw SQL; this types the table.
 */
import type { AssetId } from '@taalcut/core';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { assets } from './library';

export const assetBorrowedOffsets = sqliteTable(
  'asset_borrowed_offsets',
  {
    assetId: text('asset_id')
      .$type<AssetId>()
      .primaryKey()
      .references(() => assets.id, { onDelete: 'cascade' }),
    offsetMin: integer('offset_min').notNull(),
    lenderId: text('lender_id')
      .$type<AssetId>()
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
  },
  (t) => [index('asset_borrowed_offsets_lender_idx').on(t.lenderId)],
);
