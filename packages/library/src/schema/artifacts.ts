// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Drizzle table: artifact metadata (migration 9). The bytes are files named by `content_hash`. */
import type { ArtifactId } from '@taalcut/core';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').$type<ArtifactId>().primaryKey(),
    /** Hex SHA-256 of the stored bytes: the file's name. Several artifacts may share one file. */
    contentHash: text('content_hash').notNull(),
    mediaType: text('media_type').notNull(),
    bytes: integer('bytes').notNull(),
    /** What the model sees instead of the bytes, redacted. */
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
    /** Updated on every get: the size cap evicts the least recently used. */
    lastUsedAt: integer('last_used_at').notNull(),
  },
  (t) => [index('artifacts_hash_idx').on(t.contentHash), index('artifacts_last_used_idx').on(t.lastUsedAt)],
);
