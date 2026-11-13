// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-R1 (indexing speed): the two finish lines of an indexed asset (core's
 * index milestones), in `asset_index_state`, one row per asset that has been
 * swept: `searchable_at` is when every searchable stage that applies to the
 * asset was done or skipped, `complete_at` when every stage was; both null
 * until then and again while a re-index runs those stages anew. The jobs
 * process's pipeline writes them (indexing/milestones.ts) and backfills them
 * for assets indexed before this migration when it starts. A table of its
 * own rather than columns on `assets`: it is pipeline state written after
 * every stage, like `asset_index_stages`, not part of the asset's identity.
 *
 * `index_stages` is the stage list that pipeline registered (pipeline order
 * and milestone), so a process without the stage definitions (the agent's
 * import status and asset page) can still say which finish line a stage
 * counts toward. Rewritten whole at each pipeline start.
 *
 * The `updated_at` index lets the pipeline find the asset rows any process
 * changed since its last look (a re-index from the agent process, an import).
 */
import type { Migration } from './types';

const up = `
CREATE TABLE asset_index_state (
  asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  searchable_at INTEGER,
  complete_at INTEGER
);
CREATE TABLE index_stages (
  stage TEXT PRIMARY KEY NOT NULL,
  position INTEGER NOT NULL,
  milestone TEXT NOT NULL CHECK (milestone IN ('searchable', 'complete'))
);
CREATE INDEX asset_index_stages_updated_idx ON asset_index_stages(updated_at);
`;

const down = `
DROP INDEX asset_index_stages_updated_idx;
DROP TABLE index_stages;
DROP TABLE asset_index_state;
`;

export const indexMilestones: Migration = { version: 26, name: 'index_milestones', up, down };
