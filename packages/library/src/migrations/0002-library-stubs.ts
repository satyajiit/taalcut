// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PROVISIONAL Source, Asset and Shot tables, shaped by ADR 0001's recommended
 * hybrid storage model (decision D4, not yet approved). P2-L1 evolves them
 * with new migrations; this one is not edited once shipped.
 */
import type { Migration } from './types';

const up = `
CREATE TABLE sources (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('managed_import', 'watched_folder')),
  label TEXT NOT NULL,
  root_path TEXT,
  origin TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'missing', 'removed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((kind = 'watched_folder') = (root_path IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX sources_root_path_uq ON sources(root_path) WHERE root_path IS NOT NULL;

CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  storage TEXT NOT NULL CHECK (storage IN ('managed', 'referenced')),
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  mtime_ms INTEGER,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('video', 'image', 'audio')),
  duration_value REAL,
  duration_rate REAL CHECK (duration_rate IS NULL OR duration_rate > 0),
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'missing')),
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX assets_source_path_uq ON assets(source_id, path);
CREATE INDEX assets_content_hash_idx ON assets(content_hash);

CREATE TABLE shots (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  start_value REAL NOT NULL,
  start_rate REAL NOT NULL CHECK (start_rate > 0),
  duration_value REAL NOT NULL CHECK (duration_value >= 0),
  duration_rate REAL NOT NULL CHECK (duration_rate > 0),
  created_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX shots_asset_ordinal_uq ON shots(asset_id, ordinal);
`;

const down = `
DROP TABLE shots;
DROP TABLE assets;
DROP TABLE sources;
`;

export const libraryStubs: Migration = { version: 2, name: 'library_stubs', up, down };
