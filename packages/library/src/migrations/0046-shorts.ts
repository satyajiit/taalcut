// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Migration } from './types';

export const shorts: Migration = {
  version: 46,
  name: 'shorts',
  up: `
CREATE TABLE shorts_runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK (json_valid(document)),
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX shorts_runs_project_idx ON shorts_runs(project_id, updated_at);
CREATE TABLE shorts_analysis_cache (
  key TEXT PRIMARY KEY NOT NULL,
  document TEXT NOT NULL CHECK (json_valid(document)),
  updated_at INTEGER NOT NULL
) STRICT;
`,
  down: 'DROP TABLE shorts_analysis_cache; DROP TABLE shorts_runs;',
};
