// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template store (P2-T8): lineages with a head, immutable numbered
 * versions, content-addressed assets (contact sheets) and full-text search.
 *
 * A version keeps its document (core's Template as JSON; @taalcut/templates
 * migrates and validates it) and, read from it when stored, what a summary
 * and a search need: origin, platform, fingerprint (a repeat paste of the same
 * reel), duration, slot count, BPM and its contact sheet's asset. A template's
 * summary is its row joined with its head version.
 *
 * `template_fts` holds each lineage's head: name, slot intents and overlay
 * text. Lineages are few, so it is keyed by an UNINDEXED template_id column
 * rather than by rowid (a text-keyed table's rowids may be renumbered by VACUUM).
 */
import { SHOT_FTS_TOKENIZER } from './0013-library-search';
import type { Migration } from './types';

const up = `
CREATE TABLE templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  listed INTEGER NOT NULL CHECK (listed IN (0, 1)),
  head_version INTEGER NOT NULL CHECK (head_version >= 1),
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX templates_updated_idx ON templates(updated_at, id);
CREATE INDEX templates_project_idx ON templates(project_id) WHERE project_id IS NOT NULL;

CREATE TABLE template_versions (
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  parent_version INTEGER CHECK (parent_version IS NULL OR parent_version >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  document TEXT NOT NULL CHECK (json_valid(document)),
  change_key TEXT CHECK (change_key IS NULL OR length(change_key) BETWEEN 1 AND 128),
  command TEXT,
  source TEXT CHECK (source IS NULL OR source IN ('ui', 'shortcut', 'agent', 'mcp')),
  origin TEXT NOT NULL CHECK (origin IN ('reference', 'format', 'manual')),
  platform TEXT,
  fingerprint TEXT,
  duration_value INTEGER NOT NULL CHECK (duration_value >= 0),
  duration_rate_num INTEGER NOT NULL CHECK (duration_rate_num > 0),
  duration_rate_den INTEGER NOT NULL CHECK (duration_rate_den > 0),
  slot_count INTEGER NOT NULL CHECK (slot_count >= 1),
  bpm REAL,
  contact_sheet TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (template_id, version)
) STRICT;
CREATE INDEX template_versions_child_idx ON template_versions(template_id, parent_version, change_key);
CREATE INDEX template_versions_fingerprint_idx ON template_versions(fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX template_versions_sheet_idx ON template_versions(contact_sheet) WHERE contact_sheet IS NOT NULL;

CREATE TABLE template_assets (
  sha256 TEXT PRIMARY KEY NOT NULL CHECK (length(sha256) = 64),
  media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/webp')),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  created_at INTEGER NOT NULL
) STRICT;

CREATE VIRTUAL TABLE template_fts USING fts5(
  template_id UNINDEXED, name, intents, overlays,
  tokenize = "${SHOT_FTS_TOKENIZER}"
);
`;

const down = `
DROP TABLE template_fts;
DROP TABLE template_assets;
DROP TABLE template_versions;
DROP TABLE templates;
`;

export const templateStore: Migration = { version: 14, name: 'template_store', up, down };
