// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 1 core tables (plan P1-D3). Shipped migrations are never edited.
 * Tables are STRICT, so a wrongly typed value fails loudly instead of being stored.
 */
import type { Migration } from './types';

const json = (column: string, nullable = false): string =>
  nullable
    ? `${column} TEXT CHECK (${column} IS NULL OR json_valid(${column}))`
    : `${column} TEXT NOT NULL CHECK (json_valid(${column}))`;

const up = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE conversations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX conversations_project_idx ON conversations(project_id, updated_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  ${json('content')},
  run_id TEXT,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX messages_conversation_idx ON messages(conversation_id, id);

CREATE TABLE tool_runs (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  ${json('input')},
  ${json('output', true)},
  ${json('error', true)},
  command_id TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;
CREATE INDEX tool_runs_run_idx ON tool_runs(run_id, started_at);
CREATE INDEX tool_runs_conversation_idx ON tool_runs(conversation_id, started_at);

CREATE TABLE commands (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq > 0),
  name TEXT NOT NULL,
  ${json('payload')},
  ${json('inverse', true)},
  source TEXT NOT NULL CHECK (source IN ('ui', 'shortcut', 'agent', 'mcp')),
  actor TEXT NOT NULL,
  side_effect TEXT NOT NULL CHECK (side_effect IN ('read', 'write', 'destructive', 'external')),
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'undone', 'redone')),
  created_at INTEGER NOT NULL,
  undone_at INTEGER,
  redone_at INTEGER
) STRICT;
CREATE UNIQUE INDEX commands_scope_seq_uq ON commands(coalesce(project_id, ''), seq);
CREATE INDEX commands_project_seq_idx ON commands(project_id, seq);

CREATE TABLE agent_events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  type TEXT NOT NULL,
  ${json('payload')},
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
) STRICT;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  resource_class TEXT NOT NULL CHECK (resource_class IN ('cpu', 'gpu', 'io', 'network')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  next_run_at INTEGER NOT NULL,
  idempotency_key TEXT,
  progress REAL CHECK (progress IS NULL OR (progress >= 0 AND progress <= 1)),
  ${json('progress_detail', true)},
  ${json('payload')},
  ${json('result', true)},
  ${json('error', true)},
  lease_owner TEXT,
  lease_expires_at INTEGER,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
) STRICT;
CREATE UNIQUE INDEX jobs_idempotency_key_uq ON jobs(idempotency_key);
CREATE INDEX jobs_claim_idx ON jobs(state, resource_class, priority DESC, next_run_at);
CREATE INDEX jobs_lease_idx ON jobs(state, lease_expires_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  ${json('value')},
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE model_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
  ${json('config')},
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX model_profiles_name_uq ON model_profiles(name);
CREATE UNIQUE INDEX model_profiles_one_active_uq ON model_profiles(active) WHERE active = 1;

CREATE TABLE acknowledgements (
  id TEXT PRIMARY KEY NOT NULL,
  topic TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  acknowledged_at INTEGER NOT NULL,
  ${json('context', true)}
) STRICT;
CREATE UNIQUE INDEX acknowledgements_topic_terms_uq ON acknowledgements(topic, terms_version);

CREATE TABLE cloud_calls (
  id TEXT PRIMARY KEY NOT NULL,
  module TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  bytes_sent INTEGER NOT NULL DEFAULT 0 CHECK (bytes_sent >= 0),
  tokens_in INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (cost_micro_usd >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'cancelled')),
  error_code TEXT,
  run_id TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX cloud_calls_created_idx ON cloud_calls(created_at);
CREATE INDEX cloud_calls_module_idx ON cloud_calls(module, created_at);
`;

const down = `
DROP TABLE cloud_calls;
DROP TABLE acknowledgements;
DROP TABLE model_profiles;
DROP TABLE settings;
DROP TABLE jobs;
DROP TABLE agent_events;
DROP TABLE commands;
DROP TABLE tool_runs;
DROP TABLE messages;
DROP TABLE conversations;
DROP TABLE projects;
`;

export const phase1Core: Migration = { version: 1, name: 'phase1_core', up, down };
