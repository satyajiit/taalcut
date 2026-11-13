// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 2's media library (P2-L1, with the parts P2-L2, P2-L3 and P2-L13
 * need), still PROVISIONAL with ADR 0001 (decision D4):
 *
 * - sources: watching, scan state and cursor (resume), Wi-Fi session and device label.
 * - assets: re-index generation, MediaFacts as JSON plus the columns filters and sorting
 *   read from it, Live Photo pairing, spoken language, the Wi-Fi re-encode verdict,
 *   trash, and `detached_at` (no location left since; `library.collect` deletes after 30 days).
 * - asset_locations: inode, first/last seen, missing since, how it was found.
 * - shots: the ShotAnalysis as JSON plus the columns search, filters and casting read,
 *   the speech inside the shot, near-duplicate group and best take.
 * - transcripts, derived_files and asset_index_stages (the indexing pipeline's state).
 *
 * Down drops the new tables and columns.
 */
import type { Migration } from './types';

const json = (column: string) => `${column} TEXT CHECK (${column} IS NULL OR json_valid(${column}))`;
const flag = (column: string, fallback?: 0 | 1) =>
  fallback === undefined
    ? `${column} INTEGER CHECK (${column} IS NULL OR ${column} IN (0, 1))`
    : `${column} INTEGER NOT NULL DEFAULT ${fallback} CHECK (${column} IN (0, 1))`;
const oneOf = (column: string, values: readonly string[]) =>
  `${column} TEXT CHECK (${column} IS NULL OR ${column} IN (${values.map((v) => `'${v}'`).join(', ')}))`;

const add = (table: string, columns: readonly string[]) =>
  columns.map((column) => `ALTER TABLE ${table} ADD COLUMN ${column};`).join('\n');
const drop = (table: string, columns: readonly string[]) =>
  columns
    .map((column) => `ALTER TABLE ${table} DROP COLUMN ${column.split(' ')[0]};`)
    .reverse()
    .join('\n');

const SOURCE_COLUMNS = [
  flag('watch', 1),
  `scan_state TEXT NOT NULL DEFAULT 'idle' CHECK (scan_state IN ('idle', 'scanning', 'error'))`,
  'scan_cursor TEXT',
  'last_scan_at INTEGER',
  json('scan_error'),
  'transfer_session_id TEXT',
  'device_label TEXT',
];

const ASSET_COLUMNS = [
  'generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0)',
  'updated_at INTEGER NOT NULL DEFAULT 0',
  json('facts'),
  oneOf('orientation', ['portrait', 'landscape', 'square']),
  oneOf('hdr', ['none', 'hlg', 'pq', 'dolby-vision']),
  oneOf('speed', ['normal', 'slow-motion', 'time-lapse']),
  'frame_rate_num INTEGER CHECK (frame_rate_num IS NULL OR frame_rate_num > 0)',
  'frame_rate_den INTEGER CHECK (frame_rate_den IS NULL OR frame_rate_den > 0)',
  flag('has_audio'),
  'capture_offset_min INTEGER',
  'latitude REAL',
  'longitude REAL',
  'device_make TEXT',
  'device_model TEXT',
  'live_photo_id TEXT',
  // Not a foreign key (SQLite can't drop such a column); a trigger clears it instead.
  'companion_of TEXT',
  'language TEXT',
  oneOf('reencode', ['likely', 'unlikely', 'unknown']),
  json('reencode_reasons'),
  'trashed_at INTEGER',
  'detached_at INTEGER',
];

const LOCATION_COLUMNS = [
  'file_id INTEGER',
  'first_seen_at INTEGER',
  'last_seen_at INTEGER',
  'missing_since INTEGER',
  oneOf('via', ['scan', 'watcher', 'wifi', 'usb', 'relink']),
];

const SHOT_COLUMNS = [
  json('analysis'),
  'description TEXT',
  'objects TEXT',
  'place TEXT',
  'shot_type TEXT',
  'motion TEXT',
  'energy REAL CHECK (energy IS NULL OR (energy >= 0 AND energy <= 1))',
  'quality REAL CHECK (quality IS NULL OR (quality >= 0 AND quality <= 1))',
  'on_screen_text TEXT',
  'best_frame INTEGER CHECK (best_frame IS NULL OR best_frame >= 0)',
  'd_hash TEXT',
  'transcript_text TEXT',
  'duplicate_group TEXT',
  flag('best_take', 1),
  'generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0)',
  'created_at INTEGER NOT NULL DEFAULT 0',
];

const NEW_INDEXES = `
CREATE UNIQUE INDEX sources_transfer_session_uq ON sources(transfer_session_id) WHERE transfer_session_id IS NOT NULL;
CREATE INDEX assets_capture_idx ON assets(capture_time, id);
CREATE INDEX assets_created_idx ON assets(created_at, id);
CREATE INDEX assets_live_photo_idx ON assets(live_photo_id) WHERE live_photo_id IS NOT NULL;
CREATE INDEX assets_companion_idx ON assets(companion_of) WHERE companion_of IS NOT NULL;
CREATE INDEX assets_detached_idx ON assets(detached_at) WHERE detached_at IS NOT NULL;
CREATE INDEX asset_locations_missing_idx ON asset_locations(size_bytes) WHERE state = 'missing';
CREATE INDEX asset_locations_file_idx ON asset_locations(file_id) WHERE file_id IS NOT NULL;
CREATE INDEX shots_duplicate_group_idx ON shots(duplicate_group) WHERE duplicate_group IS NOT NULL;`;

const DROP_INDEXES = `
DROP INDEX sources_transfer_session_uq;
DROP INDEX assets_capture_idx;
DROP INDEX assets_created_idx;
DROP INDEX assets_live_photo_idx;
DROP INDEX assets_companion_idx;
DROP INDEX assets_detached_idx;
DROP INDEX asset_locations_missing_idx;
DROP INDEX asset_locations_file_idx;
DROP INDEX shots_duplicate_group_idx;`;

const NEW_TABLES = `
CREATE TABLE transcripts (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  transcript TEXT NOT NULL CHECK (json_valid(transcript)),
  language TEXT NOT NULL,
  engine TEXT NOT NULL,
  local INTEGER NOT NULL CHECK (local IN (0, 1)),
  text TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE derived_files (
  key TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  shot_id TEXT REFERENCES shots(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('proxy', 'thumbnail', 'filmstrip', 'waveform', 'still', 'conformed')),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  mime_type TEXT NOT NULL,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  duration_value INTEGER,
  duration_rate_num INTEGER CHECK (duration_rate_num IS NULL OR duration_rate_num > 0),
  duration_rate_den INTEGER CHECK (duration_rate_den IS NULL OR duration_rate_den > 0),
  frame_rate_num INTEGER CHECK (frame_rate_num IS NULL OR frame_rate_num > 0),
  frame_rate_den INTEGER CHECK (frame_rate_den IS NULL OR frame_rate_den > 0),
  recipe INTEGER NOT NULL CHECK (recipe > 0),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX derived_files_asset_idx ON derived_files(asset_id, kind);
CREATE INDEX derived_files_shot_idx ON derived_files(shot_id) WHERE shot_id IS NOT NULL;

CREATE TABLE asset_index_stages (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'queued', 'running', 'done', 'skipped', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  job_id TEXT,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (-1, 0, 1)),
  boosted_until INTEGER,
  output TEXT CHECK (output IS NULL OR (json_valid(output) AND length(output) <= 1048576)),
  reason_key TEXT,
  error TEXT CHECK (error IS NULL OR json_valid(error)),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (asset_id, stage)
) STRICT;
CREATE INDEX asset_index_stages_state_idx ON asset_index_stages(state, priority, updated_at);
CREATE INDEX asset_index_stages_stage_idx ON asset_index_stages(stage, state);
CREATE INDEX asset_index_stages_job_idx ON asset_index_stages(job_id) WHERE job_id IS NOT NULL;

-- A location found again clears the asset's detached mark (removing one is marked by the repository).
CREATE TRIGGER asset_locations_attach_on_insert AFTER INSERT ON asset_locations BEGIN
  UPDATE assets SET detached_at = NULL WHERE id = NEW.asset_id AND detached_at IS NOT NULL;
END;
-- companion_of and duplicate_group point at rows that may go; they are cleared, like ON DELETE SET NULL.
CREATE TRIGGER assets_companion_on_delete AFTER DELETE ON assets BEGIN
  UPDATE assets SET companion_of = NULL WHERE companion_of = OLD.id;
END;
CREATE TRIGGER shots_duplicate_group_on_delete AFTER DELETE ON shots BEGIN
  UPDATE shots SET duplicate_group = NULL, best_take = 1 WHERE duplicate_group = OLD.id;
END;`;

const BACKFILL = `
UPDATE assets SET updated_at = created_at;
UPDATE assets SET orientation = CASE
    WHEN coalesce(rotation_degrees, 0) IN (90, 270) THEN
      CASE WHEN width > height THEN 'portrait' WHEN width < height THEN 'landscape' ELSE 'square' END
    ELSE CASE WHEN width > height THEN 'landscape' WHEN width < height THEN 'portrait' ELSE 'square' END
  END
  WHERE width IS NOT NULL AND height IS NOT NULL;
UPDATE assets SET detached_at = created_at
  WHERE NOT EXISTS (SELECT 1 FROM asset_locations WHERE asset_id = assets.id);
UPDATE shots SET created_at = (SELECT created_at FROM assets WHERE assets.id = shots.asset_id);
UPDATE asset_locations SET via = 'scan' WHERE storage = 'referenced';`;

const up = `
${add('sources', SOURCE_COLUMNS)}
${add('assets', ASSET_COLUMNS)}
${add('asset_locations', LOCATION_COLUMNS)}
${add('shots', SHOT_COLUMNS)}
${NEW_TABLES}
${NEW_INDEXES}
${BACKFILL}
`;

const down = `
DROP TRIGGER asset_locations_attach_on_insert;
DROP TRIGGER assets_companion_on_delete;
DROP TRIGGER shots_duplicate_group_on_delete;
${DROP_INDEXES}
DROP TABLE asset_index_stages;
DROP TABLE derived_files;
DROP TABLE transcripts;
${drop('shots', SHOT_COLUMNS)}
${drop('asset_locations', LOCATION_COLUMNS)}
${drop('assets', ASSET_COLUMNS)}
${drop('sources', SOURCE_COLUMNS)}
`;

export const mediaLibraryV2: Migration = { version: 12, name: 'media_library_v2', up, down };
