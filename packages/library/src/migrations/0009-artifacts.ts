// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Artifacts (core's ArtifactStore): large tool outputs kept by reference. The
 * bytes are content-addressed files under the artifacts folder; this table
 * holds what refers to them (media type, size, the redacted summary) and when
 * each was last used, for the size cap and the retention policy.
 */
import type { Migration } from './types';

const up = `
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  media_type TEXT NOT NULL CHECK (length(media_type) BETWEEN 3 AND 255),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
) STRICT;
CREATE INDEX artifacts_hash_idx ON artifacts(content_hash);
CREATE INDEX artifacts_last_used_idx ON artifacts(last_used_at);
`;

const down = `
DROP TABLE artifacts;
`;

export const artifacts: Migration = { version: 9, name: 'artifacts', up, down };
