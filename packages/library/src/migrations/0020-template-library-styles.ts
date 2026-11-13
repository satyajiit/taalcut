// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V14 and P3-V10: the template library's metadata and Styles.
 *
 * - `templates` gains its library metadata (tags, folder, favourite, trend date and its source, provenance), kept
 *   beside the lineage so editing it makes no new version, with an index for each filter and sort.
 * - `template_versions` gains the head facts a list filters on (format, language, Style) and the summary's
 *   approved-slot count and slot strip, read from each stored document now (backfill) and on every write after.
 * - `template_folders`: names unique case-insensitively through `name_key` (NFC, lower case, any script).
 * - `template_fts` is rebuilt with a `tags` column (FTS5 keeps its content, so the rows are copied over).
 * - `styles` (one row per Style, its document as JSON, the template version a look was made from and the logo it
 *   names) and `style_assets` (content-addressed logos; `released_at` is when the last Style naming it let go).
 * - `timelines.style_id`, read from the document, so `StyleStore.usedBy` needs no JSON scan.
 *
 * Down rebuilds `templates` (a column with a foreign key can't be dropped) and copies the search rows back.
 */
import { SHOT_FTS_TOKENIZER } from './0013-library-search';
import type { Migration } from './types';

const fts = (name: string, columns: string) => `
CREATE VIRTUAL TABLE ${name} USING fts5(
  template_id UNINDEXED, ${columns},
  tokenize = "${SHOT_FTS_TOKENIZER}"
);`;

const up = `
CREATE TABLE template_folders (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  name_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX template_folders_name_uq ON template_folders(name_key);

ALTER TABLE templates ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(tags) AND json_type(tags) = 'array');
ALTER TABLE templates ADD COLUMN folder_id TEXT REFERENCES template_folders(id) ON DELETE SET NULL;
ALTER TABLE templates ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0 CHECK (favourite IN (0, 1));
ALTER TABLE templates ADD COLUMN trend_date TEXT
  CHECK (trend_date IS NULL OR trend_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE templates ADD COLUMN trend_source TEXT
  CHECK ((trend_source IS NULL) = (trend_date IS NULL)
    AND (trend_source IS NULL OR trend_source IN ('reference', 'hub', 'user')));
ALTER TABLE templates ADD COLUMN provenance TEXT CHECK (provenance IS NULL OR json_valid(provenance));
CREATE INDEX templates_folder_idx ON templates(folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX templates_favourite_idx ON templates(favourite, id);
CREATE INDEX templates_trend_idx ON templates(trend_date, id) WHERE trend_date IS NOT NULL;
CREATE INDEX templates_name_idx ON templates(name COLLATE NOCASE, id);

ALTER TABLE template_versions ADD COLUMN format_id TEXT;
ALTER TABLE template_versions ADD COLUMN language TEXT;
ALTER TABLE template_versions ADD COLUMN style_id TEXT;
ALTER TABLE template_versions ADD COLUMN approved_slots INTEGER NOT NULL DEFAULT 0 CHECK (approved_slots >= 0);
ALTER TABLE template_versions ADD COLUMN slot_strip TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(slot_strip) AND json_type(slot_strip) = 'array');
UPDATE template_versions SET
  format_id = CASE json_type(document, '$.origin.formatId')
    WHEN 'text' THEN json_extract(document, '$.origin.formatId') END,
  language = CASE json_type(document, '$.language') WHEN 'text' THEN json_extract(document, '$.language') END,
  style_id = CASE json_type(document, '$.styleId') WHEN 'text' THEN json_extract(document, '$.styleId') END,
  approved_slots = (SELECT count(*) FROM json_each(document, '$.slots') s
    WHERE json_extract(s.value, '$.approved') = 1),
  slot_strip = (SELECT json_group_array(json_extract(s.value, '$.duration.value')) FROM json_each(document, '$.slots') s
    WHERE json_type(s.value, '$.duration.value') = 'integer');
CREATE INDEX template_versions_format_idx ON template_versions(format_id) WHERE format_id IS NOT NULL;
CREATE INDEX template_versions_language_idx ON template_versions(language) WHERE language IS NOT NULL;
CREATE INDEX template_versions_style_idx ON template_versions(style_id) WHERE style_id IS NOT NULL;

${fts('template_fts_next', 'name, intents, overlays, tags')}
INSERT INTO template_fts_next (template_id, name, intents, overlays, tags)
  SELECT f.template_id, f.name, f.intents, f.overlays, (SELECT group_concat(value, ' ') FROM json_each(t.tags))
  FROM template_fts f JOIN templates t ON t.id = f.template_id;
DROP TABLE template_fts;
ALTER TABLE template_fts_next RENAME TO template_fts;

CREATE TABLE styles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('brandKit', 'look')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  document TEXT NOT NULL CHECK (json_valid(document)),
  made_from_template_id TEXT,
  made_from_version INTEGER CHECK (made_from_version IS NULL OR made_from_version >= 1),
  logo_asset TEXT CHECK (logo_asset IS NULL OR length(logo_asset) = 64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX styles_updated_idx ON styles(updated_at, id);
CREATE INDEX styles_made_from_idx ON styles(made_from_template_id, made_from_version)
  WHERE made_from_template_id IS NOT NULL;
CREATE INDEX styles_logo_idx ON styles(logo_asset) WHERE logo_asset IS NOT NULL;

CREATE TABLE style_assets (
  sha256 TEXT PRIMARY KEY NOT NULL CHECK (length(sha256) = 64),
  media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  created_at INTEGER NOT NULL,
  released_at INTEGER
) STRICT;

ALTER TABLE timelines ADD COLUMN style_id TEXT;
UPDATE timelines SET style_id = json_extract(document, '$.styleId') WHERE json_type(document, '$.styleId') = 'text';
CREATE INDEX timelines_style_idx ON timelines(style_id) WHERE style_id IS NOT NULL;
`;

const TEMPLATE_COLUMNS = 'id, name, project_id, listed, head_version, archived_at, created_at, updated_at';

const down = `
DROP INDEX timelines_style_idx;
ALTER TABLE timelines DROP COLUMN style_id;
DROP TABLE style_assets;
DROP TABLE styles;

${fts('template_fts_prev', 'name, intents, overlays')}
INSERT INTO template_fts_prev (template_id, name, intents, overlays)
  SELECT template_id, name, intents, overlays FROM template_fts;
DROP TABLE template_fts;
ALTER TABLE template_fts_prev RENAME TO template_fts;

DROP INDEX template_versions_style_idx;
DROP INDEX template_versions_language_idx;
DROP INDEX template_versions_format_idx;
ALTER TABLE template_versions DROP COLUMN slot_strip;
ALTER TABLE template_versions DROP COLUMN approved_slots;
ALTER TABLE template_versions DROP COLUMN style_id;
ALTER TABLE template_versions DROP COLUMN language;
ALTER TABLE template_versions DROP COLUMN format_id;

CREATE TABLE templates_prev (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  listed INTEGER NOT NULL CHECK (listed IN (0, 1)),
  head_version INTEGER NOT NULL CHECK (head_version >= 1),
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
INSERT INTO templates_prev (${TEMPLATE_COLUMNS}) SELECT ${TEMPLATE_COLUMNS} FROM templates;
DROP TABLE templates;
ALTER TABLE templates_prev RENAME TO templates;
CREATE INDEX templates_updated_idx ON templates(updated_at, id);
CREATE INDEX templates_project_idx ON templates(project_id) WHERE project_id IS NOT NULL;

DROP TABLE template_folders;
`;

export const templateLibraryStyles: Migration = { version: 20, name: 'template_library_styles', up, down };
