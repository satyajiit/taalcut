// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drizzle tables for an asset's profile beyond its row (P2-L1, migration 12):
 * its transcript, the files media derived from it, and the indexing
 * pipeline's per-stage state (P2-L13); plus the FTS row keys (migration 13), and each asset's finish lines
 * and the registered stages' milestones (migration 26).
 */
import {
  DERIVED_KINDS,
  INDEX_MILESTONES,
  INDEX_STAGE_STATES,
  type AssetId,
  type JobId,
  type ShotId,
} from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { assets, shots } from './library';

export const transcripts = sqliteTable('transcripts', {
  assetId: text('asset_id')
    .$type<AssetId>()
    .primaryKey()
    .references(() => assets.id, { onDelete: 'cascade' }),
  /** Transcript (core), validated on write and read. */
  transcript: text('transcript', { mode: 'json' }).$type<unknown>().notNull(),
  language: text('language').notNull(),
  engine: text('engine').notNull(),
  local: integer('local', { mode: 'boolean' }).notNull(),
  /** Plain text, for search and previews. */
  text: text('text').notNull(),
  generation: integer('generation').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const derivedFiles = sqliteTable(
  'derived_files',
  {
    /** DERIVED_KEY_PATTERN, relative to the media cache root. Never a path. */
    key: text('key').primaryKey(),
    assetId: text('asset_id')
      .$type<AssetId>()
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** Set for a shot's own thumbnail or still. */
    shotId: text('shot_id')
      .$type<ShotId>()
      .references(() => shots.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: DERIVED_KINDS }).notNull(),
    bytes: integer('bytes').notNull(),
    mimeType: text('mime_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationValue: integer('duration_value'),
    durationRateNum: integer('duration_rate_num'),
    durationRateDen: integer('duration_rate_den'),
    frameRateNum: integer('frame_rate_num'),
    frameRateDen: integer('frame_rate_den'),
    recipe: integer('recipe').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('derived_files_asset_idx').on(t.assetId, t.kind),
    index('derived_files_shot_idx')
      .on(t.shotId)
      .where(sql`${t.shotId} IS NOT NULL`),
  ],
);

export type IndexStageState = (typeof INDEX_STAGE_STATES)[number];

export const assetIndexStages = sqliteTable(
  'asset_index_stages',
  {
    assetId: text('asset_id')
      .$type<AssetId>()
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** '<package>.<camelCase>' (indexStageNameSchema). */
    stage: text('stage').notNull(),
    state: text('state', { enum: INDEX_STAGE_STATES }).notNull(),
    /** The stage definition's version that last ran (or is running) here. */
    version: integer('version').notNull().default(0),
    /** The asset's generation the stage ran for. */
    generation: integer('generation').notNull().default(0),
    jobId: text('job_id').$type<JobId>(),
    /** 1 high, 0 normal, −1 low (core's priorities). */
    priority: integer('priority').notNull().default(0),
    /** Someone waits for this asset until then (indexing.prioritise). */
    boostedUntil: integer('boosted_until'),
    /** The job's output as stored for later stages (≤ 1 MiB of JSON). */
    output: text('output', { mode: 'json' }).$type<unknown>(),
    /** i18n key: why the stage was skipped or waits. */
    reasonKey: text('reason_key'),
    /** A public error (JSON) when failed. */
    error: text('error', { mode: 'json' }).$type<unknown>(),
    attempts: integer('attempts').notNull().default(0),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    updatedAt: integer('updated_at').notNull(),
    /**
     * SHA-256 of what the stage last stored that later stages read (migration 27, round IX3): kept through
     * resets, compared when the stage stores again (indexing/invalidation.ts).
     */
    outputDigest: text('output_digest'),
  },
  (t) => [
    primaryKey({ columns: [t.assetId, t.stage] }),
    index('asset_index_stages_state_idx').on(t.state, t.priority, t.updatedAt),
    index('asset_index_stages_stage_idx').on(t.stage, t.state),
    index('asset_index_stages_job_idx')
      .on(t.jobId)
      .where(sql`${t.jobId} IS NOT NULL`),
    // Migration 26: the rows any process changed since the milestone sweep last looked.
    index('asset_index_stages_updated_idx').on(t.updatedAt),
  ],
);

/**
 * An asset's two finish lines (migration 26, IX-R1): when its searchable stages, then all its stages, were done
 * or skipped; null until then. Written by the pipeline's milestone sweep (indexing/milestones.ts).
 */
export const assetIndexState = sqliteTable('asset_index_state', {
  assetId: text('asset_id')
    .$type<AssetId>()
    .primaryKey()
    .references(() => assets.id, { onDelete: 'cascade' }),
  searchableAt: integer('searchable_at'),
  completeAt: integer('complete_at'),
});

/**
 * The stages the jobs process's pipeline registered (migration 26): pipeline order and the finish line each
 * counts toward, so processes without the definitions can tell. Rewritten whole at each pipeline start.
 */
export const indexStages = sqliteTable('index_stages', {
  stage: text('stage').primaryKey(),
  position: integer('position').notNull(),
  milestone: text('milestone', { enum: INDEX_MILESTONES }).notNull(),
});

/** A stable integer key per shot for `shot_fts` (migration 13); written by triggers only. */
export const shotSearchRows = sqliteTable(
  'shot_search_rows',
  {
    rowid: integer('rowid').primaryKey(),
    shotId: text('shot_id').$type<ShotId>().notNull(),
  },
  (t) => [uniqueIndex('shot_search_rows_shot_uq').on(t.shotId)],
);
