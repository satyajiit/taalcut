// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Agent memory (LRN1-MEM): `memory_items`, one row per core MemoryItem, and `memory_fts`, its text for keyword
 * search, kept in step by triggers. Triggers rather than store code so that items a project's or template's
 * deletion cascades away leave no search rows behind. The scope's reference is a column with a foreign key
 * (cascade); a check ties it to the scope. `data` is JSON, `data_kind` its kind, so a lookup by kind reads no JSON.
 * The vectors live in the memory index (sqlite-vec, `<space>_mem`), rebuilt from this table.
 */
import { SHOT_FTS_TOKENIZER } from './0013-library-search';
import type { Migration } from './types';

const up = `
CREATE TABLE memory_items (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('user', 'project', 'template')),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES templates(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  source TEXT NOT NULL CHECK (source IN ('user', 'agent', 'learned')),
  data_kind TEXT CHECK (data_kind IN ('casting-weights', 'what-worked')),
  data TEXT CHECK (data IS NULL OR json_valid(data)),
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((scope = 'project') = (project_id IS NOT NULL)),
  CHECK ((scope = 'template') = (template_id IS NOT NULL)),
  CHECK ((data IS NULL) = (data_kind IS NULL))
) STRICT;
CREATE INDEX memory_items_updated_idx ON memory_items(updated_at, id);
CREATE INDEX memory_items_project_idx ON memory_items(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX memory_items_template_idx ON memory_items(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX memory_items_data_kind_idx ON memory_items(data_kind) WHERE data_kind IS NOT NULL;

CREATE VIRTUAL TABLE memory_fts USING fts5(
  memory_id UNINDEXED, text,
  tokenize = "${SHOT_FTS_TOKENIZER}"
);

CREATE TRIGGER memory_fts_on_insert AFTER INSERT ON memory_items BEGIN
  INSERT INTO memory_fts (memory_id, text) VALUES (NEW.id, NEW.text);
END;

CREATE TRIGGER memory_fts_on_update AFTER UPDATE OF text ON memory_items BEGIN
  UPDATE memory_fts SET text = NEW.text WHERE memory_id = NEW.id;
END;

CREATE TRIGGER memory_fts_on_delete AFTER DELETE ON memory_items BEGIN
  DELETE FROM memory_fts WHERE memory_id = OLD.id;
END;
`;

const down = `
DROP TRIGGER memory_fts_on_delete;
DROP TRIGGER memory_fts_on_update;
DROP TRIGGER memory_fts_on_insert;
DROP TABLE memory_fts;
DROP TABLE memory_items;
`;

export const memory: Migration = { version: 30, name: 'memory', up, down };
