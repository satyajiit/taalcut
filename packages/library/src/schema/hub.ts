// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drizzle tables for the hub client (P3-B12, P3-V8; migration 21): the index and
 * ratings as last fetched (one row each) and this install's submissions.
 */
import { SUBMISSION_STATES, type HubSubmissionId, type HubTemplateId, type TemplateId } from '@taalcut/core';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const cacheColumns = () => ({
  /** Always 1: the table holds the last fetch only. */
  id: integer('id').primaryKey(),
  etag: text('etag'),
  fetchedAt: integer('fetched_at').notNull(),
  /** As fetched, JSON; validated by @taalcut/templates on read. */
  body: text('body').notNull(),
});

export const hubIndexCache = sqliteTable('hub_index_cache', cacheColumns());
export const hubRatingsCache = sqliteTable('hub_ratings_cache', cacheColumns());

export const hubSubmissions = sqliteTable(
  'hub_submissions',
  {
    /** The Worker's submission id. */
    id: text('id').$type<HubSubmissionId>().primaryKey(),
    hubId: text('hub_id').$type<HubTemplateId>().notNull(),
    version: integer('version').notNull(),
    templateId: text('template_id').$type<TemplateId>().notNull(),
    templateVersion: integer('template_version').notNull(),
    state: text('state', { enum: SUBMISSION_STATES }).notNull(),
    createdAt: integer('created_at').notNull(),
    checkedAt: integer('checked_at'),
  },
  (t) => [
    index('hub_submissions_template_idx').on(t.templateId, t.version),
    index('hub_submissions_created_idx').on(t.createdAt, t.id),
  ],
);
