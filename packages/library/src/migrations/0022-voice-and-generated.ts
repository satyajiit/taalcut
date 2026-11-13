// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B6, P3-B7, P3-V6: voice consents, and the bookkeeping generated files need.
 *
 * - voice_consents: one row per speaker's recorded consent (core voiceConsentSchema, column for field); the
 *   recording itself is a file in the store's folder, named by the consent id.
 * - generated_assets: the assets the GeneratedAssetSink kept (generated, bundled-pack and stock bytes handed to
 *   it), with the project they were made for and since when nothing refers to them. library.collect clears
 *   `unreferenced_since` while a timeline uses the asset and purges it 30 days after it was last used (or made).
 *   Cascades with the asset.
 */
import type { Migration } from './types';

const up = `
CREATE TABLE voice_consents (
  id TEXT PRIMARY KEY NOT NULL,
  speaker_name TEXT NOT NULL CHECK (length(speaker_name) BETWEEN 1 AND 80),
  language TEXT NOT NULL,
  terms_version TEXT NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 16),
  recording_sha256 TEXT NOT NULL CHECK (length(recording_sha256) = 64),
  recording_duration_ms INTEGER NOT NULL CHECK (recording_duration_ms BETWEEN 60000 AND 600000),
  phrase_match REAL NOT NULL CHECK (phrase_match BETWEEN 0 AND 1),
  recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0),
  clone TEXT CHECK (clone IS NULL OR json_valid(clone)),
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX voice_consents_recorded_idx ON voice_consents(recorded_at, id);

CREATE TABLE generated_assets (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  unreferenced_since INTEGER
) STRICT;
CREATE INDEX generated_assets_unreferenced_idx ON generated_assets(unreferenced_since)
  WHERE unreferenced_since IS NOT NULL;
CREATE INDEX generated_assets_project_idx ON generated_assets(project_id) WHERE project_id IS NOT NULL;
`;

const down = `
DROP TABLE generated_assets;
DROP TABLE voice_consents;
`;

export const voiceAndGenerated: Migration = { version: 22, name: 'voice_and_generated', up, down };
