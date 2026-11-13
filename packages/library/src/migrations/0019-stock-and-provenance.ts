// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V18: asset provenance, the licence row a stock import records, the search
 * cache, a wider sources.kind check (stock_import, generated, bundled) and the
 * render columns Content Credentials and batch id need.
 * Down fails if a source uses one of the widened kinds (same note as migration 11).
 */
import type { Migration } from './types';

const SOURCE_COLUMNS = `id, kind, display_name, root_path, volume_uuid, volume_name, status, created_at, updated_at,
  watch, scan_state, scan_cursor, last_scan_at, scan_error, transfer_session_id, device_label`;

const sourceTable = (name: string, kinds: string): string => `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (${kinds})),
  display_name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  volume_uuid TEXT,
  volume_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('online', 'offline', 'missing')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  watch INTEGER NOT NULL DEFAULT 1 CHECK (watch IN (0, 1)),
  scan_state TEXT NOT NULL DEFAULT 'idle' CHECK (scan_state IN ('idle', 'scanning', 'error')),
  scan_cursor TEXT,
  last_scan_at INTEGER,
  scan_error TEXT CHECK (scan_error IS NULL OR json_valid(scan_error)),
  transfer_session_id TEXT,
  device_label TEXT
) STRICT;`;

const rebuildSources = (kinds: string): string => `
${sourceTable('sources_next', kinds)}
INSERT INTO sources_next (${SOURCE_COLUMNS}) SELECT ${SOURCE_COLUMNS} FROM sources;
DROP TABLE sources;
ALTER TABLE sources_next RENAME TO sources;
CREATE UNIQUE INDEX sources_transfer_session_uq ON sources(transfer_session_id)
  WHERE transfer_session_id IS NOT NULL;`;

const widened = `'wifi_import', 'usb_import', 'watched_folder', 'stock_import', 'generated', 'bundled'`;
const original = `'wifi_import', 'usb_import', 'watched_folder'`;

const up = `
ALTER TABLE assets ADD COLUMN provenance TEXT NOT NULL DEFAULT '{"kind":"captured"}'
  CHECK (json_valid(provenance));

CREATE TABLE asset_licences (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('pexels', 'freesound', 'bundled')),
  provider_asset_id TEXT NOT NULL,
  licence TEXT NOT NULL,
  raw_licence TEXT NOT NULL,
  nc_excluded INTEGER NOT NULL CHECK (nc_excluded = 1),
  author TEXT,
  author_url TEXT,
  source_url TEXT,
  attribution TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX asset_licences_provider_uq ON asset_licences(source, provider_asset_id);

CREATE TABLE stock_search_cache (
  key TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
) STRICT;

${rebuildSources(widened)}

ALTER TABLE renders ADD COLUMN credentials TEXT CHECK (credentials IS NULL OR json_valid(credentials));
ALTER TABLE renders ADD COLUMN batch_id TEXT;
CREATE INDEX renders_batch_idx ON renders(batch_id) WHERE batch_id IS NOT NULL;
UPDATE renders SET batch_id = json_extract(request, '$.batchId')
  WHERE batch_id IS NULL AND json_type(request, '$.batchId') = 'text';
`;

const down = `
DROP INDEX renders_batch_idx;
ALTER TABLE renders DROP COLUMN batch_id;
ALTER TABLE renders DROP COLUMN credentials;
${rebuildSources(original)}
DROP TABLE stock_search_cache;
DROP TABLE asset_licences;
ALTER TABLE assets DROP COLUMN provenance;
`;

export const stockAndProvenance: Migration = { version: 19, name: 'stock_and_provenance', up, down };
