// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-WS: a project's HyperFrames workspace. `workspace_revisions` holds core's WorkspaceRevision, one row each:
 * the files (path, sha256, bytes) as JSON, checked by core's schema on every read and write, with their count and
 * total bytes as columns so the limits hold in SQL too. `command_id` is the `workspace.writeFiles` that made it, so
 * a redo moves the head back to the same revision instead of making another. `workspace_heads` is the revision the
 * workspace is at (0: empty); `workspace.restore` moves it. Both go with their project. The files' bytes are blobs
 * under `<userData>/workspaces/<projectId>/blobs/`, never in the database.
 */
import type { Migration } from './types';

const up = `
CREATE TABLE workspace_revisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  base INTEGER NOT NULL CHECK (base >= 0 AND base < revision),
  files TEXT NOT NULL CHECK (json_valid(files) AND json_type(files) = 'array'),
  file_count INTEGER NOT NULL CHECK (file_count BETWEEN 0 AND 512),
  bytes INTEGER NOT NULL CHECK (bytes BETWEEN 0 AND 2097152),
  origin TEXT NOT NULL CHECK (origin IN ('ui', 'shortcut', 'agent', 'mcp')),
  command_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, revision)
) STRICT;
CREATE UNIQUE INDEX workspace_revisions_command_uq ON workspace_revisions(command_id)
  WHERE command_id IS NOT NULL;
CREATE TABLE workspace_heads (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  updated_at INTEGER NOT NULL
) STRICT;
`;

const down = `
DROP TABLE workspace_heads;
DROP TABLE workspace_revisions;
`;

export const workspaces: Migration = { version: 41, name: 'workspaces', up, down };
