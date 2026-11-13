// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PROVISIONAL: ADR 0001 "Phase 1 schema stubs" (decision D4, awaiting PO
 * approval). Replaces migration 2's guesses with Source, Asset, AssetLocation
 * and Shot exactly as the ADR specifies. Migration 2's tables never held user
 * data (nothing has shipped), so they are rebuilt, not converted.
 *
 * Asset availability is derived by triggers on asset_locations, so it changes
 * in the same transaction as any location insert, state change, retarget or
 * delete (including cascades when a source is removed). Priority: any
 * `present` → online; else any `icloud_placeholder`; else any `offline`; else missing.
 */
import { libraryStubs } from './0002-library-stubs';
import type { Migration } from './types';

const derive = (assetId: string): string => `
  UPDATE assets SET availability = CASE
    WHEN EXISTS (SELECT 1 FROM asset_locations WHERE asset_id = ${assetId} AND state = 'present') THEN 'online'
    WHEN EXISTS (SELECT 1 FROM asset_locations WHERE asset_id = ${assetId} AND state = 'icloud_placeholder')
      THEN 'icloud_placeholder'
    WHEN EXISTS (SELECT 1 FROM asset_locations WHERE asset_id = ${assetId} AND state = 'offline') THEN 'offline'
    ELSE 'missing'
  END
  WHERE id = ${assetId};`;

/** Asset availability follows its locations (migration 8 recreates these after rebuilding assets). */
export const availabilityTriggers = `CREATE TRIGGER assets_availability_on_insert AFTER INSERT ON assets BEGIN${derive('NEW.id')}
END;
CREATE TRIGGER asset_locations_availability_on_insert AFTER INSERT ON asset_locations BEGIN${derive('NEW.asset_id')}
END;
CREATE TRIGGER asset_locations_availability_on_update AFTER UPDATE OF state, asset_id ON asset_locations BEGIN${derive('OLD.asset_id')}${derive('NEW.asset_id')}
END;
CREATE TRIGGER asset_locations_availability_on_delete AFTER DELETE ON asset_locations BEGIN${derive('OLD.asset_id')}
END;`;

const up = `
DROP TABLE shots;
DROP TABLE assets;
DROP TABLE sources;

CREATE TABLE sources (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('wifi_import', 'usb_import', 'watched_folder')),
  display_name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  volume_uuid TEXT,
  volume_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('online', 'offline', 'missing')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE assets (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'image', 'audio', 'live_photo')),
  content_hash_alg TEXT CHECK (content_hash_alg IS NULL OR content_hash_alg = 'blake3'),
  content_hash TEXT,
  partial_hash TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  original_filename TEXT NOT NULL,
  capture_time INTEGER,
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  rotation_degrees INTEGER CHECK (rotation_degrees IS NULL OR rotation_degrees IN (0, 90, 180, 270)),
  duration_value INTEGER,
  duration_rate INTEGER CHECK (duration_rate IS NULL OR duration_rate > 0),
  availability TEXT NOT NULL CHECK (availability IN ('online', 'offline', 'missing', 'icloud_placeholder')),
  created_at INTEGER NOT NULL,
  CHECK ((content_hash IS NULL) = (content_hash_alg IS NULL)),
  CHECK ((duration_value IS NULL) = (duration_rate IS NULL))
) STRICT;
CREATE UNIQUE INDEX assets_content_hash_uq ON assets(content_hash_alg, content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX assets_partial_hash_idx ON assets(partial_hash) WHERE partial_hash IS NOT NULL;

CREATE TABLE asset_locations (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  storage TEXT NOT NULL CHECK (storage IN ('managed', 'referenced')),
  relative_path TEXT NOT NULL,
  absolute_path_cached TEXT,
  volume_uuid TEXT,
  partial_hash TEXT,
  full_hash TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  mtime_ms INTEGER,
  state TEXT NOT NULL CHECK (state IN ('present', 'offline', 'missing', 'icloud_placeholder'))
) STRICT;
CREATE UNIQUE INDEX asset_locations_path_uq ON asset_locations(asset_id, source_id, relative_path);
CREATE UNIQUE INDEX asset_locations_one_managed_uq ON asset_locations(asset_id) WHERE storage = 'managed';
CREATE INDEX asset_locations_source_idx ON asset_locations(source_id, relative_path);
CREATE INDEX asset_locations_volume_idx ON asset_locations(volume_uuid) WHERE volume_uuid IS NOT NULL;
CREATE INDEX asset_locations_partial_hash_idx ON asset_locations(partial_hash) WHERE partial_hash IS NOT NULL;

CREATE TABLE shots (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  index_in_asset INTEGER NOT NULL CHECK (index_in_asset >= 0),
  start_value INTEGER NOT NULL,
  start_rate INTEGER NOT NULL CHECK (start_rate > 0),
  duration_value INTEGER NOT NULL CHECK (duration_value >= 0),
  duration_rate INTEGER NOT NULL CHECK (duration_rate > 0)
) STRICT;
CREATE UNIQUE INDEX shots_asset_index_uq ON shots(asset_id, index_in_asset);

${availabilityTriggers}
`;

const down = `
DROP TABLE asset_locations;
DROP TABLE shots;
DROP TABLE assets;
DROP TABLE sources;
${libraryStubs.up}`;

export const libraryAdr0001: Migration = { version: 4, name: 'library_adr_0001', up, down };
