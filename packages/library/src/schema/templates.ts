// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drizzle tables for the template store (P2-T8, migration 14): lineages,
 * immutable versions with the summary fields read from each document, and
 * content-addressed assets. `template_fts` (FTS5) is queried with SQL.
 * Migration 20 (P3-V14): each lineage's library metadata, the head facts a
 * list filters on, and folders. Migration 24: the name sort's Unicode key.
 * Migration 37 (REF1): each template's kept reel.
 */
import {
  COMMAND_SOURCES,
  TEMPLATE_MEDIA_SOURCES,
  TREND_SOURCES,
  type FormatId,
  type ProjectId,
  type StyleId,
  type TemplateFolderId,
  type TemplateId,
} from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { projects } from './chat';

export const TEMPLATE_ORIGINS = ['reference', 'format', 'manual'] as const;
export const TEMPLATE_ASSET_TYPES = ['image/jpeg', 'image/webp'] as const;

export const templateFolders = sqliteTable(
  'template_folders',
  {
    id: text('id').$type<TemplateFolderId>().primaryKey(),
    name: text('name').notNull(),
    /** NFC and lower case: what makes two names the same folder. */
    nameKey: text('name_key').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('template_folders_name_uq').on(t.nameKey)],
);

export const templates = sqliteTable(
  'templates',
  {
    id: text('id').$type<TemplateId>().primaryKey(),
    name: text('name').notNull(),
    /** Where it was made; null for app-wide (or once that project is gone). */
    projectId: text('project_id')
      .$type<ProjectId>()
      .references(() => projects.id, { onDelete: 'set null' }),
    listed: integer('listed', { mode: 'boolean' }).notNull(),
    headVersion: integer('head_version').notNull(),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    /** Migration 20: normalised tags (templateTagSchema), as a JSON array. */
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    folderId: text('folder_id')
      .$type<TemplateFolderId>()
      .references(() => templateFolders.id, { onDelete: 'set null' }),
    favourite: integer('favourite', { mode: 'boolean' }).notNull().default(false),
    /** YYYY-MM-DD (UTC); set with its source or not at all. */
    trendDate: text('trend_date'),
    trendSource: text('trend_source', { enum: TREND_SOURCES }),
    /** TemplateProvenance as JSON; null for the person's own. */
    provenance: text('provenance', { mode: 'json' }).$type<unknown>(),
    /** Migration 24: what the name sort orders by (stores/template-name-key.ts). */
    nameKey: text('name_key').notNull().default(''),
  },
  (t) => [
    index('templates_updated_idx').on(t.updatedAt, t.id),
    index('templates_project_idx')
      .on(t.projectId)
      .where(sql`${t.projectId} IS NOT NULL`),
    index('templates_folder_idx')
      .on(t.folderId)
      .where(sql`${t.folderId} IS NOT NULL`),
    index('templates_favourite_idx').on(t.favourite, t.id),
    index('templates_trend_idx')
      .on(t.trendDate, t.id)
      .where(sql`${t.trendDate} IS NOT NULL`),
    // Migration 24: a name sort breaks ties by the larger id either way, so each direction has its index.
    index('templates_name_key_asc_idx').on(t.nameKey, sql`${t.id} DESC`),
    index('templates_name_key_desc_idx').on(t.nameKey, t.id),
  ],
);

export const templateVersions = sqliteTable(
  'template_versions',
  {
    templateId: text('template_id')
      .$type<TemplateId>()
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    parentVersion: integer('parent_version'),
    schemaVersion: integer('schema_version').notNull(),
    /** The Template as JSON; @taalcut/templates migrates and validates it. */
    document: text('document', { mode: 'json' }).$type<unknown>().notNull(),
    /** sha256 of the canonical command and payload that made it: redo finds it again. */
    changeKey: text('change_key'),
    command: text('command'),
    source: text('source', { enum: COMMAND_SOURCES }),
    origin: text('origin', { enum: TEMPLATE_ORIGINS }).notNull(),
    platform: text('platform'),
    /** sha256 of the analysed reference: finds an earlier breakdown of the same reel. */
    fingerprint: text('fingerprint'),
    durationValue: integer('duration_value').notNull(),
    durationRateNum: integer('duration_rate_num').notNull(),
    durationRateDen: integer('duration_rate_den').notNull(),
    slotCount: integer('slot_count').notNull(),
    bpm: real('bpm'),
    /** The contact sheet's template asset (sha256). */
    contactSheet: text('contact_sheet'),
    createdAt: integer('created_at').notNull(),
    // Migration 20: what a list filters on and a summary shows, read from the document.
    formatId: text('format_id').$type<FormatId>(),
    language: text('language'),
    styleId: text('style_id').$type<StyleId>(),
    approvedSlots: integer('approved_slots').notNull().default(0),
    /** The slots' lengths in canvas frames, as a JSON array. */
    slotStrip: text('slot_strip', { mode: 'json' }).$type<number[]>().notNull().default([]),
  },
  (t) => [
    primaryKey({ columns: [t.templateId, t.version] }),
    index('template_versions_child_idx').on(t.templateId, t.parentVersion, t.changeKey),
    index('template_versions_fingerprint_idx')
      .on(t.fingerprint)
      .where(sql`${t.fingerprint} IS NOT NULL`),
    index('template_versions_sheet_idx')
      .on(t.contactSheet)
      .where(sql`${t.contactSheet} IS NOT NULL`),
    index('template_versions_format_idx')
      .on(t.formatId)
      .where(sql`${t.formatId} IS NOT NULL`),
    index('template_versions_language_idx')
      .on(t.language)
      .where(sql`${t.language} IS NOT NULL`),
    index('template_versions_style_idx')
      .on(t.styleId)
      .where(sql`${t.styleId} IS NOT NULL`),
  ],
);

export const templateAssets = sqliteTable('template_assets', {
  sha256: text('sha256').primaryKey(),
  mediaType: text('media_type', { enum: TEMPLATE_ASSET_TYPES }).notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: integer('created_at').notNull(),
});

/** Migration 37 (REF1): a template's kept reel, video and music; its file is in the template's media folder. */
export const templateMedia = sqliteTable('template_media', {
  templateId: text('template_id')
    .$type<TemplateId>()
    .primaryKey()
    .references(() => templates.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  bytes: integer('bytes').notNull(),
  durationMs: integer('duration_ms').notNull(),
  sha256: text('sha256').notNull(),
  hasAudio: integer('has_audio', { mode: 'boolean' }).notNull(),
  source: text('source', { enum: TEMPLATE_MEDIA_SOURCES }).notNull(),
  keptAt: integer('kept_at').notNull(),
});
