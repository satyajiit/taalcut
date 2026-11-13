// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Registry of vector indexes (P1-D4). The vec0 virtual tables themselves are
 * created by the index when it opens, because they need the sqlite-vec
 * extension and migrations must run without it. Drop indexes through
 * `VectorIndex.drop()` before migrating below this version.
 */
import type { Migration } from './types';

const up = `
CREATE TABLE vector_indexes (
  name TEXT PRIMARY KEY NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  metric TEXT NOT NULL CHECK (metric IN ('cosine', 'l2')),
  created_at INTEGER NOT NULL
) STRICT;
`;

const down = `
DROP TABLE vector_indexes;
`;

export const vectorRegistry: Migration = { version: 3, name: 'vector_registry', up, down };
