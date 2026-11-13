// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B12, P3-V8: what the hub client keeps. The index and the ratings as last
 * fetched (one row each, the body unvalidated: @taalcut/templates validates it on
 * read), with the ETag for the next conditional fetch; and the templates this
 * install shared, so an update keeps its hub id and My submissions lists them
 * with their last known state. No foreign key to `templates`: a shared template
 * stays on the hub after the person deletes their copy.
 */
import type { Migration } from './types';

const cacheTable = (name: string): string => `
CREATE TABLE ${name} (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  etag TEXT CHECK (etag IS NULL OR length(etag) BETWEEN 1 AND 512),
  fetched_at INTEGER NOT NULL CHECK (fetched_at >= 0),
  body TEXT NOT NULL CHECK (json_valid(body))
) STRICT;`;

const up = `
${cacheTable('hub_index_cache')}
${cacheTable('hub_ratings_cache')}

CREATE TABLE hub_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  hub_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL CHECK (template_version >= 1),
  state TEXT NOT NULL CHECK (state IN ('open', 'merged', 'closed', 'hidden')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  checked_at INTEGER CHECK (checked_at IS NULL OR checked_at >= 0)
) STRICT;
CREATE INDEX hub_submissions_template_idx ON hub_submissions(template_id, version);
CREATE INDEX hub_submissions_created_idx ON hub_submissions(created_at, id);
`;

const down = `
DROP TABLE hub_submissions;
DROP TABLE hub_ratings_cache;
DROP TABLE hub_index_cache;
`;

export const hubClient: Migration = { version: 21, name: 'hub_client', up, down };
