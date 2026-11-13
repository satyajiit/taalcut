// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's resource classes gained `npu` and `video` (core SPEC 14, RESOURCE_CLASSES).
 * The jobs table's CHECK still listed only cpu, gpu, io and network, so a
 * media.extractFrame enqueue (class video) failed before a row existed.
 * Rebuild the table. A down that meets an npu or video row fails the old CHECK.
 */
import type { Migration } from './types';

const COLUMNS = `id, kind, state, priority, resource_class, attempts, max_attempts, next_run_at,
  idempotency_key, progress, progress_detail, payload, result, error, lease_owner, lease_expires_at,
  project_id, parent_id, created_at, updated_at, started_at, finished_at, interruptions`;

const table = (name: string, classes: string): string => `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  resource_class TEXT NOT NULL CHECK (resource_class IN (${classes})),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  next_run_at INTEGER,
  idempotency_key TEXT,
  progress REAL CHECK (progress IS NULL OR (progress >= 0 AND progress <= 1)),
  progress_detail TEXT CHECK (progress_detail IS NULL OR json_valid(progress_detail)),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  error TEXT CHECK (error IS NULL OR json_valid(error)),
  lease_owner TEXT,
  lease_expires_at INTEGER,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  interruptions INTEGER NOT NULL DEFAULT 0 CHECK (interruptions >= 0)
) STRICT;`;

const indexes = `
CREATE INDEX jobs_claim_idx ON jobs(state, resource_class, priority DESC, next_run_at);
CREATE INDEX jobs_lease_idx ON jobs(state, lease_expires_at);
CREATE UNIQUE INDEX jobs_idempotency_live_uq ON jobs(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND state IN ('queued', 'running', 'paused', 'succeeded');
CREATE INDEX jobs_project_idx ON jobs(project_id, created_at);
CREATE INDEX jobs_parent_idx ON jobs(parent_id);`;

const rebuild = (classes: string): string => `
${table('jobs_next', classes)}
INSERT INTO jobs_next (${COLUMNS}) SELECT ${COLUMNS} FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_next RENAME TO jobs;
${indexes}`;

const up = rebuild(`'cpu', 'gpu', 'npu', 'video', 'io', 'network'`);
const down = rebuild(`'cpu', 'gpu', 'io', 'network'`);

export const jobResourceClasses: Migration = { version: 11, name: 'job_resource_classes', up, down };
