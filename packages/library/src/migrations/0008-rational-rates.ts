// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PROVISIONAL (ADR 0001, decision D4 still awaits PO approval). Asset and shot
 * times become core's RationalTime exactly: a value plus the rate's numerator
 * and denominator. Migration 4 stored one integer rate, which can't hold NTSC
 * (29.97 fps is 30000/1001), so 24000 frames at 23.976 read back as 1 s or
 * 1000 s instead of 1001 s. A correctness fix, not the D4 decision.
 *
 * Up: an old rate r becomes r/1 (every value it could hold). Down: value v at
 * num/den becomes v × den at rate num, the same number of seconds.
 */
import { availabilityTriggers } from './0004-library-adr-0001';
import type { Migration } from './types';

const assetColumns = `
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
  rotation_degrees INTEGER CHECK (rotation_degrees IS NULL OR rotation_degrees IN (0, 90, 180, 270)),`;

const assetTail = `
  availability TEXT NOT NULL CHECK (availability IN ('online', 'offline', 'missing', 'icloud_placeholder')),
  created_at INTEGER NOT NULL,
  CHECK ((content_hash IS NULL) = (content_hash_alg IS NULL)),`;

const assetIndexes = `
CREATE UNIQUE INDEX assets_content_hash_uq ON assets(content_hash_alg, content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX assets_partial_hash_idx ON assets(partial_hash) WHERE partial_hash IS NOT NULL;`;

/**
 * Dropping assets drops its trigger, and renaming the rebuilt table fails while the asset_locations
 * triggers name a table that is gone, so all four are dropped first and recreated after.
 */
const dropTriggers = `
DROP TRIGGER asset_locations_availability_on_insert;
DROP TRIGGER asset_locations_availability_on_update;
DROP TRIGGER asset_locations_availability_on_delete;`;

const sharedAssetColumns =
  'id, kind, content_hash_alg, content_hash, partial_hash, size_bytes, original_filename, capture_time, ' +
  'width, height, rotation_degrees, availability, created_at';

const up = `${dropTriggers}
CREATE TABLE assets_v8 (${assetColumns}
  duration_value INTEGER,
  duration_rate_num INTEGER CHECK (duration_rate_num IS NULL OR duration_rate_num > 0),
  duration_rate_den INTEGER CHECK (duration_rate_den IS NULL OR duration_rate_den > 0),${assetTail}
  CHECK ((duration_value IS NULL) = (duration_rate_num IS NULL)),
  CHECK ((duration_value IS NULL) = (duration_rate_den IS NULL))
) STRICT;
INSERT INTO assets_v8 (${sharedAssetColumns}, duration_value, duration_rate_num, duration_rate_den)
  SELECT ${sharedAssetColumns}, duration_value, duration_rate,
    CASE WHEN duration_rate IS NULL THEN NULL ELSE 1 END
  FROM assets;
DROP TABLE assets;
ALTER TABLE assets_v8 RENAME TO assets;${assetIndexes}
${availabilityTriggers}

CREATE TABLE shots_v8 (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  index_in_asset INTEGER NOT NULL CHECK (index_in_asset >= 0),
  start_value INTEGER NOT NULL,
  start_rate_num INTEGER NOT NULL CHECK (start_rate_num > 0),
  start_rate_den INTEGER NOT NULL CHECK (start_rate_den > 0),
  duration_value INTEGER NOT NULL CHECK (duration_value >= 0),
  duration_rate_num INTEGER NOT NULL CHECK (duration_rate_num > 0),
  duration_rate_den INTEGER NOT NULL CHECK (duration_rate_den > 0)
) STRICT;
INSERT INTO shots_v8 (id, asset_id, index_in_asset, start_value, start_rate_num, start_rate_den,
    duration_value, duration_rate_num, duration_rate_den)
  SELECT id, asset_id, index_in_asset, start_value, start_rate, 1, duration_value, duration_rate, 1 FROM shots;
DROP TABLE shots;
ALTER TABLE shots_v8 RENAME TO shots;
CREATE UNIQUE INDEX shots_asset_index_uq ON shots(asset_id, index_in_asset);
`;

const down = `${dropTriggers}
CREATE TABLE assets_v4 (${assetColumns}
  duration_value INTEGER,
  duration_rate INTEGER CHECK (duration_rate IS NULL OR duration_rate > 0),${assetTail}
  CHECK ((duration_value IS NULL) = (duration_rate IS NULL))
) STRICT;
INSERT INTO assets_v4 (${sharedAssetColumns}, duration_value, duration_rate)
  SELECT ${sharedAssetColumns}, duration_value * duration_rate_den, duration_rate_num FROM assets;
DROP TABLE assets;
ALTER TABLE assets_v4 RENAME TO assets;${assetIndexes}
${availabilityTriggers}

CREATE TABLE shots_v4 (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  index_in_asset INTEGER NOT NULL CHECK (index_in_asset >= 0),
  start_value INTEGER NOT NULL,
  start_rate INTEGER NOT NULL CHECK (start_rate > 0),
  duration_value INTEGER NOT NULL CHECK (duration_value >= 0),
  duration_rate INTEGER NOT NULL CHECK (duration_rate > 0)
) STRICT;
INSERT INTO shots_v4 (id, asset_id, index_in_asset, start_value, start_rate, duration_value, duration_rate)
  SELECT id, asset_id, index_in_asset, start_value * start_rate_den, start_rate_num,
    duration_value * duration_rate_den, duration_rate_num
  FROM shots;
DROP TABLE shots;
ALTER TABLE shots_v4 RENAME TO shots;
CREATE UNIQUE INDEX shots_asset_index_uq ON shots(asset_id, index_in_asset);
`;

export const rationalRates: Migration = { version: 8, name: 'rational_rates', up, down };
