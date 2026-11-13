// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { availabilityTriggers } from './0004-library-adr-0001';

/** SQLite cannot widen a CHECK in place. Preserve all location IDs, indexes and availability triggers. */
export const importLocationVias = `
DROP TRIGGER assets_availability_on_insert;
CREATE TABLE asset_locations_next (
 id TEXT PRIMARY KEY NOT NULL,
 asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
 storage TEXT NOT NULL CHECK(storage IN ('managed','referenced')),
 relative_path TEXT NOT NULL, absolute_path_cached TEXT, volume_uuid TEXT, partial_hash TEXT, full_hash TEXT,
 size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),mtime_ms INTEGER,
 state TEXT NOT NULL CHECK(state IN ('present','offline','missing','icloud_placeholder')),
 file_id INTEGER,first_seen_at INTEGER,last_seen_at INTEGER,missing_since INTEGER,
 via TEXT CHECK(via IS NULL OR via IN ('scan','watcher','wifi','usb','relink','local','camera','photos'))
) STRICT;
INSERT INTO asset_locations_next SELECT * FROM asset_locations;
DROP TABLE asset_locations;
ALTER TABLE asset_locations_next RENAME TO asset_locations;
CREATE UNIQUE INDEX asset_locations_path_uq ON asset_locations(asset_id,source_id,relative_path);
CREATE UNIQUE INDEX asset_locations_one_managed_uq ON asset_locations(asset_id) WHERE storage='managed';
CREATE INDEX asset_locations_source_idx ON asset_locations(source_id,relative_path);
CREATE INDEX asset_locations_volume_idx ON asset_locations(volume_uuid) WHERE volume_uuid IS NOT NULL;
CREATE INDEX asset_locations_partial_hash_idx ON asset_locations(partial_hash) WHERE partial_hash IS NOT NULL;
CREATE INDEX asset_locations_missing_idx ON asset_locations(size_bytes) WHERE state='missing';
CREATE INDEX asset_locations_file_idx ON asset_locations(file_id) WHERE file_id IS NOT NULL;
${availabilityTriggers}
CREATE TRIGGER asset_locations_attach_on_insert AFTER INSERT ON asset_locations BEGIN
 UPDATE assets SET detached_at=NULL WHERE id=NEW.asset_id AND detached_at IS NOT NULL;
END;
`;
