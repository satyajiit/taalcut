// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { importLocationVias } from './lib2-location-vias';
import type { Migration } from './types';

const up = `
CREATE TABLE import_drafts (
 id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
 private_data TEXT NOT NULL CHECK(json_valid(private_data)), created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE import_draft_items (
 draft_id TEXT NOT NULL REFERENCES import_drafts(id) ON DELETE CASCADE, id TEXT NOT NULL,
 ordinal INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), locator TEXT NOT NULL CHECK(json_valid(locator)),
 PRIMARY KEY(draft_id,id)
) STRICT;
CREATE INDEX import_draft_items_order ON import_draft_items(draft_id,ordinal);
CREATE TABLE import_sessions (
 id TEXT PRIMARY KEY NOT NULL, draft_id TEXT UNIQUE REFERENCES import_drafts(id), method TEXT NOT NULL,
 status TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX import_sessions_history ON import_sessions(created_at DESC,id DESC);
CREATE TABLE import_session_items (
 session_id TEXT NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE, id TEXT NOT NULL,
 ordinal INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(session_id,id)
) STRICT;
CREATE INDEX import_session_items_order ON import_session_items(session_id,ordinal);
CREATE TABLE import_provenance (
 upload_id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, channel TEXT NOT NULL,
 original_filename TEXT NOT NULL, imported_at INTEGER NOT NULL
) STRICT;
CREATE INDEX import_provenance_asset ON import_provenance(asset_id,source_id);
CREATE TABLE sources_next (
 id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('wifi_import','usb_import','watched_folder','stock_import','generated','bundled','local_import','camera_import','photos_import')),
 display_name TEXT NOT NULL, root_path TEXT NOT NULL, volume_uuid TEXT, volume_name TEXT,
 status TEXT NOT NULL CHECK(status IN ('online','offline','missing')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 watch INTEGER NOT NULL DEFAULT 1 CHECK(watch IN (0,1)),
 scan_state TEXT NOT NULL DEFAULT 'idle' CHECK(scan_state IN ('idle','scanning','error')),
 scan_cursor TEXT, last_scan_at INTEGER, scan_error TEXT CHECK(scan_error IS NULL OR json_valid(scan_error)),
 transfer_session_id TEXT, device_label TEXT
) STRICT;
INSERT INTO sources_next SELECT * FROM sources;
DROP TABLE sources;
ALTER TABLE sources_next RENAME TO sources;
CREATE UNIQUE INDEX sources_transfer_session_uq ON sources(transfer_session_id) WHERE transfer_session_id IS NOT NULL;
${importLocationVias}
CREATE VIEW library_asset_sources AS SELECT asset_id,source_id,state FROM asset_locations
UNION SELECT p.asset_id,p.source_id,a.availability AS state FROM import_provenance p JOIN assets a ON a.id=p.asset_id
WHERE NOT EXISTS (SELECT 1 FROM asset_locations l WHERE l.asset_id=p.asset_id AND l.source_id=p.source_id);

`;

export const importSessions: Migration = {
  version: 43,
  name: 'import_sessions',
  up,
  down: `DROP VIEW library_asset_sources; DROP TABLE import_session_items; DROP TABLE import_sessions; DROP TABLE import_draft_items;
    DROP TABLE import_drafts; DROP TABLE import_provenance;`,
};
