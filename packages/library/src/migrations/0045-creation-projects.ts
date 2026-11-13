// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Migration } from './types';

export const creationProjects: Migration = {
  version: 45,
  name: 'creation_projects',
  up: `
CREATE TABLE creation_projects (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL CHECK (json_valid(state)),
  updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE authored_programs (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  hash TEXT NOT NULL,
  manifest TEXT NOT NULL CHECK (json_valid(manifest)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, id, hash)
) STRICT;
`,
  down: 'DROP TABLE authored_programs; DROP TABLE creation_projects;',
};
