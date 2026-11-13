// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Migration } from './types';

export const captureArchives: Migration = {
  version: 44,
  name: 'capture_archives',
  up: `
CREATE TABLE capture_archives (
  id TEXT PRIMARY KEY NOT NULL,
  capture_key TEXT NOT NULL UNIQUE,
  manifest TEXT NOT NULL CHECK (json_valid(manifest)),
  updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE capture_assets (
  capture_id TEXT NOT NULL REFERENCES capture_archives(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  PRIMARY KEY (capture_id, member_name)
) STRICT;
CREATE TABLE local_import_receipts (
  fingerprint TEXT PRIMARY KEY NOT NULL,
  asset_ids TEXT NOT NULL CHECK (json_valid(asset_ids)),
  archive_id TEXT REFERENCES capture_archives(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE import_source_scopes (
  source_id TEXT PRIMARY KEY NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  recursive INTEGER NOT NULL CHECK (recursive IN (0,1))
) STRICT;
CREATE TABLE photos_imports (
  asset_key TEXT PRIMARY KEY NOT NULL,
  manifest TEXT NOT NULL CHECK (json_valid(manifest)),
  updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE import_capture_locks (capture_key TEXT PRIMARY KEY NOT NULL, pid INTEGER NOT NULL) STRICT;
CREATE TABLE import_space_reservations (
  owner TEXT PRIMARY KEY NOT NULL,
  volume TEXT NOT NULL,
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  pid INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX import_space_volume ON import_space_reservations(volume);
CREATE TABLE import_volume_barriers (volume TEXT PRIMARY KEY NOT NULL, pid INTEGER NOT NULL) STRICT;
CREATE TABLE import_volume_readers (
  owner TEXT NOT NULL,
  volume TEXT NOT NULL,
  pid INTEGER NOT NULL,
  PRIMARY KEY (owner, volume)
) STRICT;
`,
  down: `DROP TABLE local_import_receipts; DROP TABLE capture_assets; DROP TABLE import_source_scopes; DROP TABLE photos_imports; DROP TABLE import_capture_locks; DROP TABLE import_volume_barriers; DROP TABLE import_volume_readers; DROP TABLE import_space_reservations; DROP TABLE capture_archives;`,
};
