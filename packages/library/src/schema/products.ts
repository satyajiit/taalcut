// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Drizzle mirrors of product migrations; product stores own JSON validation and writes. */
import { index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { desc } from 'drizzle-orm';

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey().notNull(),
    revision: integer('revision').notNull(),
    archivedAt: integer('archived_at'),
    updatedAt: integer('updated_at').notNull(),
    bodyJson: text('body_json', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [index('products_active').on(table.archivedAt, table.id)],
);

export const productKnowledge = sqliteTable(
  'product_knowledge',
  {
    id: text('id').primaryKey().notNull(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    locator: text('locator').notNull(),
    digest: text('digest').notNull(),
    bodyJson: text('body_json', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [
    unique('sqlite_autoindex_product_knowledge_2').on(table.productId, table.sourceId, table.locator),
    index('product_knowledge_source').on(table.productId, table.sourceId),
    index('product_knowledge_page').on(table.productId, table.id),
    index('product_knowledge_coverage').on(table.productId, table.locator, table.id),
    index('product_knowledge_source_page').on(table.productId, table.sourceId, table.id),
  ],
);

export const productIdeas = sqliteTable(
  'product_ideas',
  {
    id: text('id').primaryKey().notNull(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    featureKey: text('feature_key').notNull(),
    createdAt: integer('created_at').notNull(),
    bodyJson: text('body_json', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [
    index('product_ideas_history').on(table.productId, desc(table.createdAt)),
    index('product_ideas_feature').on(table.productId, table.featureKey, desc(table.createdAt)),
    index('product_ideas_page').on(table.productId, desc(table.id)),
  ],
);

export const productCampaigns = sqliteTable(
  'product_campaigns',
  {
    id: text('id').primaryKey().notNull(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    ideaId: text('idea_id')
      .notNull()
      .references(() => productIdeas.id),
    projectId: text('project_id').notNull(),
    revision: integer('revision').notNull(),
    createdAt: integer('created_at').notNull(),
    bodyJson: text('body_json', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [
    unique('sqlite_autoindex_product_campaigns_2').on(table.productId, table.ideaId),
    index('product_campaigns_project').on(table.projectId),
    index('product_campaigns_history').on(table.productId, desc(table.createdAt)),
    index('product_campaigns_page').on(table.productId, desc(table.id)),
  ],
);

export const productSchedules = sqliteTable(
  'product_schedules',
  {
    productId: text('product_id')
      .primaryKey()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    nextRunAt: integer('next_run_at'),
    bodyJson: text('body_json', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [index('product_schedules_due').on(table.enabled, table.nextRunAt)],
);

export const productOccurrences = sqliteTable(
  'product_occurrences',
  {
    id: text('id').primaryKey().notNull(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    scheduledFor: integer('scheduled_for').notNull(),
    state: text('state').notNull(),
    leaseUntil: integer('lease_until').notNull(),
    bodyJson: text('body_json', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [
    unique('sqlite_autoindex_product_occurrences_2').on(table.productId, table.scheduledFor),
    index('product_occurrences_expired').on(table.state, table.leaseUntil),
  ],
);

export const productNotifications = sqliteTable(
  'product_notifications',
  {
    id: text('id').primaryKey().notNull(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    readAt: integer('read_at'),
    bodyJson: text('body_json', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [index('product_notifications_inbox').on(table.productId, desc(table.createdAt))],
);

export const productPublications = sqliteTable(
  'product_publications',
  {
    id: text('id').primaryKey().notNull(),
    batchId: text('batch_id').notNull(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    campaignId: text('campaign_id').notNull(),
    status: text('status').notNull(),
    revision: integer('revision').notNull(),
    updatedAt: integer('updated_at').notNull(),
    bodyJson: text('body_json', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [
    index('product_publications_campaign').on(table.campaignId),
    index('product_publications_status').on(table.status, table.updatedAt),
  ],
);

export const productPublishReconcileCursor = sqliteTable(
  'product_publish_reconcile_cursor',
  {
    // A table-level key preserves SQLite's reported nullability for INTEGER PRIMARY KEY without NOT NULL.
    singleton: integer('singleton'),
    afterId: text('after_id'),
  },
  (table) => [primaryKey({ columns: [table.singleton] })],
);
