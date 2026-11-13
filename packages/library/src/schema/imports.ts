// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Durable import selections, sessions and source provenance (migrations 43–44). */
import {
  IMPORT_METHODS,
  IMPORT_SESSION_STATUSES,
  type AssetId,
  type ImportDraft,
  type ImportDraftId,
  type ImportItem,
  type ImportItemOutcome,
  type ImportSession,
  type ImportSessionId,
  type SourceId,
  type TransferUploadId,
} from '@taalcut/core';
import { desc } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { assets, sources } from './library';

export const importDrafts = sqliteTable('import_drafts', {
  id: text('id').$type<ImportDraftId>().primaryKey(),
  body: text('body', { mode: 'json' }).$type<ImportDraft>().notNull(),
  /** Adapter checkpoints and capture groups stay private to the import service. */
  privateData: text('private_data', { mode: 'json' }).$type<unknown>().notNull(),
  createdAt: integer('created_at').notNull(),
});

export const importDraftItems = sqliteTable(
  'import_draft_items',
  {
    draftId: text('draft_id')
      .$type<ImportDraftId>()
      .notNull()
      .references(() => importDrafts.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    ordinal: integer('ordinal').notNull(),
    body: text('body', { mode: 'json' }).$type<ImportItem>().notNull(),
    locator: text('locator', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.id] }),
    index('import_draft_items_order').on(t.draftId, t.ordinal),
  ],
);

export const importSessions = sqliteTable(
  'import_sessions',
  {
    id: text('id').$type<ImportSessionId>().primaryKey(),
    // Migration 43 declares this UNIQUE inline; SQLite owns the autoindex name.
    draftId: text('draft_id')
      .$type<ImportDraftId>()
      .unique('sqlite_autoindex_import_sessions_2')
      .references(() => importDrafts.id),
    method: text('method', { enum: IMPORT_METHODS }).notNull(),
    status: text('status', { enum: IMPORT_SESSION_STATUSES }).notNull(),
    body: text('body', { mode: 'json' }).$type<ImportSession>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('import_sessions_history').on(desc(t.createdAt), desc(t.id))],
);

export const importSessionItems = sqliteTable(
  'import_session_items',
  {
    sessionId: text('session_id')
      .$type<ImportSessionId>()
      .notNull()
      .references(() => importSessions.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    ordinal: integer('ordinal').notNull(),
    body: text('body', { mode: 'json' }).$type<ImportItemOutcome>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.id] }),
    index('import_session_items_order').on(t.sessionId, t.ordinal),
  ],
);

export const importProvenance = sqliteTable(
  'import_provenance',
  {
    uploadId: text('upload_id').$type<TransferUploadId>().primaryKey(),
    assetId: text('asset_id')
      .$type<AssetId>()
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .$type<SourceId>()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    originalFilename: text('original_filename').notNull(),
    importedAt: integer('imported_at').notNull(),
  },
  (t) => [index('import_provenance_asset').on(t.assetId, t.sourceId)],
);

export const importSourceScopes = sqliteTable('import_source_scopes', {
  sourceId: text('source_id')
    .$type<SourceId>()
    .primaryKey()
    .references(() => sources.id, { onDelete: 'cascade' }),
  recursive: integer('recursive', { mode: 'boolean' }).notNull(),
});
