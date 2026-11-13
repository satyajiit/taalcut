// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Drizzle table: the vector index registry (P1-D4). The vec0 tables themselves are created by the index. */
import { VECTOR_METRICS, type VectorMetric } from '@taalcut/core';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export { VECTOR_METRICS, type VectorMetric };

export const vectorIndexes = sqliteTable('vector_indexes', {
  name: text('name').primaryKey(),
  dimensions: integer('dimensions').notNull(),
  metric: text('metric', { enum: VECTOR_METRICS }).notNull(),
  createdAt: integer('created_at').notNull(),
});
