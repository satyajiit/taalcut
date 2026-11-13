// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Preserved camera captures and import receipts (migration 44); manifests are validated by their adapters. */
import type { AssetId, CaptureGroupId } from '@taalcut/core';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { assets } from './library';

export const captureArchives = sqliteTable('capture_archives', {
  id: text('id').$type<CaptureGroupId>().primaryKey(),
  // Migration 44 declares this UNIQUE inline; SQLite owns the autoindex name.
  captureKey: text('capture_key').notNull().unique('sqlite_autoindex_capture_archives_2'),
  manifest: text('manifest', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const captureAssets = sqliteTable(
  'capture_assets',
  {
    captureId: text('capture_id')
      .$type<CaptureGroupId>()
      .notNull()
      .references(() => captureArchives.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .$type<AssetId>()
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    memberName: text('member_name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.captureId, t.memberName] })],
);

export const localImportReceipts = sqliteTable('local_import_receipts', {
  fingerprint: text('fingerprint').primaryKey(),
  assetIds: text('asset_ids', { mode: 'json' }).$type<AssetId[]>().notNull(),
  archiveId: text('archive_id')
    .$type<CaptureGroupId>()
    .references(() => captureArchives.id, { onDelete: 'cascade' }),
  updatedAt: integer('updated_at').notNull(),
});

/** PhotoKit resource checkpoints retain metadata separately from the unmodified originals. */
export const photosImports = sqliteTable('photos_imports', {
  assetKey: text('asset_key').primaryKey(),
  manifest: text('manifest', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});
