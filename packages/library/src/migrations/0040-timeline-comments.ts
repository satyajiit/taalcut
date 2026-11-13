// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Comments on a timeline (EDT1-CMT): `timeline_comments`, one row per core TimelineComment. A comment goes with its
 * timeline and its project (cascade). The anchor, its moment and the reply's change refs are JSON, checked by core's
 * schema on every read and write; the status and author are columns, so the editor's lists and a run's sent
 * comments read no JSON.
 */
import type { Migration } from './types';

const up = `
CREATE TABLE timeline_comments (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline_id TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  anchor TEXT NOT NULL CHECK (json_valid(anchor)),
  at TEXT CHECK (at IS NULL OR json_valid(at)),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  author TEXT NOT NULL CHECK (author IN ('user', 'agent')),
  status TEXT NOT NULL CHECK (status IN ('open', 'sent', 'resolved', 'dismissed')),
  reply TEXT CHECK (reply IS NULL OR length(reply) BETWEEN 1 AND 300),
  change_refs TEXT CHECK (change_refs IS NULL OR json_valid(change_refs)),
  run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX timeline_comments_timeline_idx ON timeline_comments(timeline_id, created_at, id);
CREATE INDEX timeline_comments_project_idx ON timeline_comments(project_id, status);
`;

const down = `
DROP TABLE timeline_comments;
`;

export const timelineComments: Migration = { version: 40, name: 'timeline_comments', up, down };
