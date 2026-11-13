// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Projects, timelines and saved timeline versions (P2-X3, with P2-M1's table
 * and P2-X1's budget cap):
 *
 * - projects: archive (deleting in the UI archives, undoably), last opened, and
 *   the spending cap as micro-units plus currency (both null: no cap).
 * - cloud_calls gets a (project_id, started_at) index: a project's spend is summed there.
 * - timelines: the working copy (core's Timeline as JSON) with its revision and the
 *   summary fields read from it when stored (template ref, cast, clip count, duration).
 * - timeline_versions: saved snapshots, numbered per timeline, with the revision captured
 *   and a sha-256 of the canonical document (an `auto` identical to the last is skipped).
 * - timeline_asset_refs: the assets a timeline's clips use, rewritten on every put. ON DELETE
 *   RESTRICT, so an asset a timeline uses can't be collected.
 */
import type { Migration } from './types';

const PROJECT_COLUMNS = [
  'archived_at INTEGER',
  'last_opened_at INTEGER',
  'budget_cap_micros INTEGER CHECK (budget_cap_micros IS NULL OR budget_cap_micros >= 0)',
  `budget_cap_currency TEXT CHECK (budget_cap_currency IS NULL OR length(budget_cap_currency) = 3)`,
];

const up = `
${PROJECT_COLUMNS.map((column) => `ALTER TABLE projects ADD COLUMN ${column};`).join('\n')}
CREATE INDEX projects_archived_idx ON projects(archived_at, updated_at);
CREATE INDEX cloud_calls_project_idx ON cloud_calls(project_id, started_at);

CREATE TABLE timelines (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  document TEXT NOT NULL CHECK (json_valid(document)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  template_id TEXT,
  template_version INTEGER CHECK (template_version IS NULL OR template_version >= 1),
  cast_id TEXT,
  variant_index INTEGER CHECK (variant_index IS NULL OR variant_index BETWEEN 0 AND 9),
  clip_count INTEGER NOT NULL CHECK (clip_count >= 0),
  duration_value INTEGER NOT NULL CHECK (duration_value >= 0),
  duration_rate_num INTEGER NOT NULL CHECK (duration_rate_num > 0),
  duration_rate_den INTEGER NOT NULL CHECK (duration_rate_den > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((template_id IS NULL) = (template_version IS NULL))
) STRICT;
CREATE INDEX timelines_project_idx ON timelines(project_id, updated_at);
CREATE INDEX timelines_template_idx ON timelines(template_id) WHERE template_id IS NOT NULL;

CREATE TABLE timeline_versions (
  id TEXT PRIMARY KEY NOT NULL,
  timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('auto', 'named', 'before-restore', 'export')),
  label TEXT CHECK (label IS NULL OR length(label) BETWEEN 1 AND 100),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  document TEXT NOT NULL CHECK (json_valid(document)),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  document_hash TEXT NOT NULL CHECK (length(document_hash) = 64),
  command_id TEXT,
  created_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX timeline_versions_number_uq ON timeline_versions(timeline_id, number);
CREATE INDEX timeline_versions_kind_idx ON timeline_versions(timeline_id, kind, number);

CREATE TABLE timeline_asset_refs (
  timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (timeline_id, asset_id)
) STRICT;
CREATE INDEX timeline_asset_refs_asset_idx ON timeline_asset_refs(asset_id);
`;

const down = `
DROP TABLE timeline_asset_refs;
DROP TABLE timeline_versions;
DROP TABLE timelines;
DROP INDEX cloud_calls_project_idx;
DROP INDEX projects_archived_idx;
${PROJECT_COLUMNS.map((column) => `ALTER TABLE projects DROP COLUMN ${column.split(' ')[0]};`)
  .reverse()
  .join('\n')}
`;

export const projectsVersions: Migration = { version: 15, name: 'projects_versions', up, down };
