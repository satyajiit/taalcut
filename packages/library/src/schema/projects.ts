// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drizzle tables for timelines and their saved versions (P2-X3, migration 15),
 * renders (P2-M11, migration 16) and the telemetry outbox (P2-X7, migration
 * 17). Projects themselves are in chat.ts.
 */
import {
  EXPORT_PRESET_IDS,
  MUSIC_PATHS,
  RENDER_STATUSES,
  TIMELINE_VERSION_KINDS,
  type AssetId,
  type CastId,
  type CommandId,
  type JobId,
  type ProjectId,
  type RenderBatchId,
  type RenderId,
  type StyleId,
  type TemplateId,
  type TimelineId,
  type TimelineVersionId,
} from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { projects } from './chat';
import { assets } from './library';

export const timelines = sqliteTable(
  'timelines',
  {
    id: text('id').$type<TimelineId>().primaryKey(),
    projectId: text('project_id')
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    /** The working copy (core's Timeline as JSON); @taalcut/timeline migrates and validates it. */
    document: text('document', { mode: 'json' }).$type<unknown>().notNull(),
    /** +1 per put: what renders and versions call the timeline's revision. */
    revision: integer('revision').notNull(),
    templateId: text('template_id').$type<TemplateId>(),
    templateVersion: integer('template_version'),
    castId: text('cast_id').$type<CastId>(),
    variantIndex: integer('variant_index'),
    clipCount: integer('clip_count').notNull(),
    durationValue: integer('duration_value').notNull(),
    durationRateNum: integer('duration_rate_num').notNull(),
    durationRateDen: integer('duration_rate_den').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    /** Migration 20: the document's Style, so StyleStore.usedBy reads no JSON. */
    styleId: text('style_id').$type<StyleId>(),
  },
  (t) => [
    index('timelines_project_idx').on(t.projectId, t.updatedAt),
    index('timelines_template_idx')
      .on(t.templateId)
      .where(sql`${t.templateId} IS NOT NULL`),
    index('timelines_style_idx')
      .on(t.styleId)
      .where(sql`${t.styleId} IS NOT NULL`),
  ],
);

export const timelineVersions = sqliteTable(
  'timeline_versions',
  {
    id: text('id').$type<TimelineVersionId>().primaryKey(),
    timelineId: text('timeline_id')
      .$type<TimelineId>()
      .notNull()
      .references(() => timelines.id, { onDelete: 'cascade' }),
    /** 1, 2, 3… per timeline. */
    number: integer('number').notNull(),
    kind: text('kind', { enum: TIMELINE_VERSION_KINDS }).notNull(),
    label: text('label'),
    schemaVersion: integer('schema_version').notNull(),
    document: text('document', { mode: 'json' }).$type<unknown>().notNull(),
    /** The timeline revision it captured. */
    revision: integer('revision').notNull(),
    /** sha-256 of the canonical JSON document. */
    documentHash: text('document_hash').notNull(),
    commandId: text('command_id').$type<CommandId>(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('timeline_versions_number_uq').on(t.timelineId, t.number),
    index('timeline_versions_kind_idx').on(t.timelineId, t.kind, t.number),
  ],
);

export const timelineAssetRefs = sqliteTable(
  'timeline_asset_refs',
  {
    timelineId: text('timeline_id')
      .$type<TimelineId>()
      .notNull()
      .references(() => timelines.id, { onDelete: 'cascade' }),
    /** RESTRICT: an asset a timeline uses can't be collected. */
    assetId: text('asset_id')
      .$type<AssetId>()
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ columns: [t.timelineId, t.assetId] }),
    index('timeline_asset_refs_asset_idx').on(t.assetId),
  ],
);

export const renders = sqliteTable(
  'renders',
  {
    id: text('id').$type<RenderId>().primaryKey(),
    projectId: text('project_id')
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    timelineId: text('timeline_id').$type<TimelineId>().notNull(),
    timelineRevision: integer('timeline_revision').notNull(),
    presetId: text('preset_id', { enum: EXPORT_PRESET_IDS }).notNull(),
    status: text('status', { enum: RENDER_STATUSES }).notNull(),
    jobId: text('job_id').$type<JobId>(),
    name: text('name').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    rateNum: integer('rate_num').notNull(),
    rateDen: integer('rate_den').notNull(),
    durationFrames: integer('duration_frames').notNull(),
    bytes: integer('bytes'),
    music: text('music', { enum: MUSIC_PATHS }).notNull(),
    captions: text('captions', { mode: 'json' }).$type<unknown>().notNull(),
    /** The QA summary a window sees. */
    qa: text('qa', { mode: 'json' }).$type<unknown>(),
    /** The full QA report: never in a snapshot. */
    qaReport: text('qa_report', { mode: 'json' }).$type<unknown>(),
    supersedes: text('supersedes').$type<RenderId>(),
    notify: integer('notify', { mode: 'boolean' }).notNull(),
    error: text('error', { mode: 'json' }).$type<unknown>(),
    /** The render.export payload (core's ExportRequest). */
    request: text('request', { mode: 'json' }).$type<unknown>().notNull(),
    requestKey: text('request_key').notNull(),
    /** Absolute path of the finished file: main and render processes only. */
    filePath: text('file_path'),
    compositionHash: text('composition_hash'),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
    deletedAt: integer('deleted_at'),
    /** Migration 19. Null reads as `{ added: false, state: null }`. */
    credentials: text('credentials', { mode: 'json' }).$type<unknown>(),
    batchId: text('batch_id').$type<RenderBatchId>(),
  },
  (t) => [
    index('renders_project_idx').on(t.projectId, t.createdAt),
    index('renders_request_key_idx').on(t.requestKey, t.status),
    index('renders_timeline_idx').on(t.timelineId, t.timelineRevision),
    index('renders_batch_idx')
      .on(t.batchId)
      .where(sql`${t.batchId} IS NOT NULL`),
  ],
);

export const telemetryOutbox = sqliteTable('telemetry_outbox', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** A telemetryEnvelopeSchema envelope, checked on append and on take. */
  envelope: text('envelope', { mode: 'json' }).$type<unknown>().notNull(),
  createdAt: integer('created_at').notNull(),
});
