// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What core's persistence ports need (packages/core/SPEC.md, sections 6, 10
 * and 11):
 *
 * - commands: `idempotency_key` (unique across the log when set, since
 *   `findByIdempotencyKey` takes no scope) and `result` (JSON). `project_id`
 *   was already nullable.
 * - agent_runs: one summary row per agent run (status, last seq), written in
 *   the same transaction as the run's events. Backfilled from agent_events.
 * - jobs: rebuilt so `next_run_at` can be null (core's `nextAttemptAt`), with
 *   `parent_id`, and with the idempotency key unique only among live jobs
 *   (queued, running, paused, succeeded): a failed or cancelled job no longer
 *   blocks a new one with its key.
 * - cloud_calls: every field of core's CloudCallRecord.
 * - acknowledgements: `topic` is now `feature_id`.
 * - model_profiles (one row per profile, a guess at models' schema) is
 *   replaced by model_profile_state: one opaque JSON document that
 *   @taalcut/models owns and validates.
 */
import type { Migration } from './types';

const LIVE_JOB_STATES = `('queued', 'running', 'paused', 'succeeded')`;

const jobsTable = (name: string, nextRunAt: string, parent: boolean): string => `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  resource_class TEXT NOT NULL CHECK (resource_class IN ('cpu', 'gpu', 'io', 'network')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  next_run_at INTEGER${nextRunAt},
  idempotency_key TEXT,
  progress REAL CHECK (progress IS NULL OR (progress >= 0 AND progress <= 1)),
  progress_detail TEXT CHECK (progress_detail IS NULL OR json_valid(progress_detail)),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  error TEXT CHECK (error IS NULL OR json_valid(error)),
  lease_owner TEXT,
  lease_expires_at INTEGER,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,${parent ? '\n  parent_id TEXT,' : ''}
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
) STRICT;`;

const JOB_COLUMNS = `id, kind, state, priority, resource_class, attempts, max_attempts, next_run_at,
  idempotency_key, progress, progress_detail, payload, result, error, lease_owner, lease_expires_at,
  project_id, created_at, updated_at, started_at, finished_at`;

/**
 * Down: v4 needs `next_run_at` and a key unique on every row. A failed or cancelled job may share its key
 * with a live one (v5 allows that), so only live jobs keep their key.
 */
const v4JobValues = JOB_COLUMNS.replace('next_run_at', 'coalesce(next_run_at, created_at)').replace(
  'idempotency_key',
  `CASE WHEN state IN ${LIVE_JOB_STATES} THEN idempotency_key END`,
);

const jobIndexes = `
CREATE INDEX jobs_claim_idx ON jobs(state, resource_class, priority DESC, next_run_at);
CREATE INDEX jobs_lease_idx ON jobs(state, lease_expires_at);`;

const up = `
ALTER TABLE commands ADD COLUMN idempotency_key TEXT
  CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 512);
ALTER TABLE commands ADD COLUMN result TEXT CHECK (result IS NULL OR json_valid(result));
CREATE UNIQUE INDEX commands_idempotency_key_uq ON commands(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE agent_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'succeeded', 'failed', 'cancelled')),
  last_seq INTEGER NOT NULL CHECK (last_seq >= 0),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX agent_runs_status_idx ON agent_runs(status, updated_at);
CREATE INDEX agent_runs_conversation_idx ON agent_runs(conversation_id, updated_at);
INSERT INTO agent_runs (run_id, conversation_id, status, last_seq, started_at, updated_at)
  SELECT run_id, NULL, 'running', max(seq), min(created_at), max(created_at) FROM agent_events GROUP BY run_id;
${jobsTable('jobs_v5', '', true)}
INSERT INTO jobs_v5 (${JOB_COLUMNS}) SELECT ${JOB_COLUMNS} FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_v5 RENAME TO jobs;
${jobIndexes}
CREATE UNIQUE INDEX jobs_idempotency_live_uq ON jobs(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND state IN ${LIVE_JOB_STATES};
CREATE INDEX jobs_project_idx ON jobs(project_id, created_at);
CREATE INDEX jobs_parent_idx ON jobs(parent_id);

DROP INDEX cloud_calls_created_idx;
DROP INDEX cloud_calls_module_idx;
ALTER TABLE cloud_calls RENAME COLUMN tokens_in TO input_tokens;
ALTER TABLE cloud_calls RENAME COLUMN tokens_out TO output_tokens;
ALTER TABLE cloud_calls RENAME COLUMN status TO outcome;
ALTER TABLE cloud_calls RENAME COLUMN created_at TO started_at;
ALTER TABLE cloud_calls ADD COLUMN reasoning TEXT NOT NULL DEFAULT 'off'
  CHECK (reasoning IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'));
ALTER TABLE cloud_calls ADD COLUMN local INTEGER NOT NULL DEFAULT 0 CHECK (local IN (0, 1));
ALTER TABLE cloud_calls ADD COLUMN bytes_received INTEGER NOT NULL DEFAULT 0 CHECK (bytes_received >= 0);
ALTER TABLE cloud_calls ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0);
ALTER TABLE cloud_calls ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0);
ALTER TABLE cloud_calls ADD COLUMN http_status INTEGER;
ALTER TABLE cloud_calls ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1);
ALTER TABLE cloud_calls ADD COLUMN span_id TEXT;
CREATE INDEX cloud_calls_started_idx ON cloud_calls(started_at);
CREATE INDEX cloud_calls_module_idx ON cloud_calls(module, started_at);
CREATE INDEX cloud_calls_run_idx ON cloud_calls(run_id);

DROP INDEX acknowledgements_topic_terms_uq;
ALTER TABLE acknowledgements RENAME COLUMN topic TO feature_id;
CREATE UNIQUE INDEX acknowledgements_feature_terms_uq ON acknowledgements(feature_id, terms_version);

DROP TABLE model_profiles;
CREATE TABLE model_profile_state (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  state TEXT NOT NULL CHECK (json_valid(state)),
  updated_at INTEGER NOT NULL
) STRICT;
`;

const down = `
DROP TABLE model_profile_state;
CREATE TABLE model_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
  config TEXT NOT NULL CHECK (json_valid(config)),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX model_profiles_name_uq ON model_profiles(name);
CREATE UNIQUE INDEX model_profiles_one_active_uq ON model_profiles(active) WHERE active = 1;

DROP INDEX acknowledgements_feature_terms_uq;
ALTER TABLE acknowledgements RENAME COLUMN feature_id TO topic;
CREATE UNIQUE INDEX acknowledgements_topic_terms_uq ON acknowledgements(topic, terms_version);

DROP INDEX cloud_calls_started_idx;
DROP INDEX cloud_calls_module_idx;
DROP INDEX cloud_calls_run_idx;
ALTER TABLE cloud_calls DROP COLUMN span_id;
ALTER TABLE cloud_calls DROP COLUMN attempt;
ALTER TABLE cloud_calls DROP COLUMN http_status;
ALTER TABLE cloud_calls DROP COLUMN cache_write_tokens;
ALTER TABLE cloud_calls DROP COLUMN cached_input_tokens;
ALTER TABLE cloud_calls DROP COLUMN bytes_received;
ALTER TABLE cloud_calls DROP COLUMN local;
ALTER TABLE cloud_calls DROP COLUMN reasoning;
ALTER TABLE cloud_calls RENAME COLUMN started_at TO created_at;
ALTER TABLE cloud_calls RENAME COLUMN outcome TO status;
ALTER TABLE cloud_calls RENAME COLUMN output_tokens TO tokens_out;
ALTER TABLE cloud_calls RENAME COLUMN input_tokens TO tokens_in;
CREATE INDEX cloud_calls_created_idx ON cloud_calls(created_at);
CREATE INDEX cloud_calls_module_idx ON cloud_calls(module, created_at);
${jobsTable('jobs_v4', ' NOT NULL', false)}
INSERT INTO jobs_v4 (${JOB_COLUMNS})
  SELECT ${v4JobValues} FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_v4 RENAME TO jobs;
CREATE UNIQUE INDEX jobs_idempotency_key_uq ON jobs(idempotency_key);
${jobIndexes}

DROP TABLE agent_runs;

DROP INDEX commands_idempotency_key_uq;
ALTER TABLE commands DROP COLUMN result;
ALTER TABLE commands DROP COLUMN idempotency_key;
`;

export const corePorts: Migration = {
  version: 5,
  name: 'core_ports',
  up,
  down,
  // Before review 2's fix, down kept every job's key and failed when a failed and a queued job shared one.
  replaces: ['470abedb5adcd107'],
};
