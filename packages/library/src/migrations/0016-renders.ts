// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Renders (P2-M11): one row per core RenderRecord, for the render lane's
 * RenderStore. The snapshot's fields are columns (captions, QA summary and
 * error as JSON); the export request and the full QA report are JSON;
 * `request_key` de-duplicates `render.export` (same key, not failed,
 * cancelled or deleted). `file_path` never leaves the main and render
 * processes: it is not part of any snapshot.
 */
import type { Migration } from './types';

const STATUSES = `'queued', 'rendering', 'checking', 'fixing', 'ready', 'needsAttention', 'failed', 'cancelled'`;
const json = (column: string, nullable = true) =>
  nullable
    ? `${column} TEXT CHECK (${column} IS NULL OR json_valid(${column}))`
    : `${column} TEXT NOT NULL CHECK (json_valid(${column}))`;

const up = `
CREATE TABLE renders (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline_id TEXT NOT NULL,
  timeline_revision INTEGER NOT NULL CHECK (timeline_revision >= 1),
  preset_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (${STATUSES})),
  job_id TEXT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  rate_num INTEGER NOT NULL CHECK (rate_num > 0),
  rate_den INTEGER NOT NULL CHECK (rate_den > 0),
  duration_frames INTEGER NOT NULL CHECK (duration_frames >= 0),
  bytes INTEGER CHECK (bytes IS NULL OR bytes >= 0),
  music TEXT NOT NULL,
  ${json('captions', false)},
  ${json('qa')},
  ${json('qa_report')},
  supersedes TEXT,
  notify INTEGER NOT NULL CHECK (notify IN (0, 1)),
  ${json('error')},
  ${json('request', false)},
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 1 AND 256),
  file_path TEXT,
  composition_hash TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  deleted_at INTEGER
) STRICT;
CREATE INDEX renders_project_idx ON renders(project_id, created_at);
CREATE INDEX renders_request_key_idx ON renders(request_key, status);
CREATE INDEX renders_timeline_idx ON renders(timeline_id, timeline_revision);
`;

const down = `
DROP TABLE renders;
`;

export const renders: Migration = { version: 16, name: 'renders', up, down };
