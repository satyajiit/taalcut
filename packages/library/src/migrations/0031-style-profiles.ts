// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Style profiles (LRN1-STY): `style_profiles`, one derived profile per source set (core's styleSourceKey), with
 * the digest of the member versions it was built from and its summary; and `project_styles`, the set each project
 * is made like (`styleProfile.use`, the person's choice). Profiles are derived data: a set whose collection or folder
 * is deleted loses its profile by trigger, and a rebuild may replace any row. A project's style goes with the
 * project (cascade); it stays when its set goes, and QA then has no band to check (the check is skipped).
 */
import type { Migration } from './types';

const up = `
CREATE TABLE style_profiles (
  source_key TEXT PRIMARY KEY NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  profile TEXT CHECK (profile IS NULL OR json_valid(profile)),
  summary TEXT NOT NULL CHECK (json_valid(summary)),
  built_at INTEGER NOT NULL
) STRICT;

CREATE TABLE project_styles (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX project_styles_source_idx ON project_styles(source_key);

CREATE TRIGGER style_profiles_on_folder_delete AFTER DELETE ON template_folders BEGIN
  DELETE FROM style_profiles WHERE source_key = 'folder:' || OLD.id;
END;

CREATE TRIGGER style_profiles_on_collection_delete AFTER DELETE ON instagram_collections BEGIN
  DELETE FROM style_profiles WHERE source_key = 'instagram-collection:' || OLD.id;
END;
`;

const down = `
DROP TRIGGER style_profiles_on_collection_delete;
DROP TRIGGER style_profiles_on_folder_delete;
DROP INDEX project_styles_source_idx;
DROP TABLE project_styles;
DROP TABLE style_profiles;
`;

export const styleProfiles: Migration = { version: 31, name: 'style_profiles', up, down };
