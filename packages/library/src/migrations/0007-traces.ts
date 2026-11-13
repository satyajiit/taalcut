// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Persisted agent traces for the developer trace viewer (P1-G5): one row per
 * run and one per span, in the viewer's shapes. Token and cost numbers are
 * columns so run summaries aggregate in SQL; the other span attributes are
 * JSON. The store keeps the newest runs only (TraceStore's retention cap).
 */
import type { Migration } from './types';

const up = `
CREATE TABLE trace_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'succeeded', 'failed', 'cancelled')),
  message TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  gaps TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(gaps))
) STRICT;
CREATE INDEX trace_runs_started_idx ON trace_runs(started_at);

CREATE TABLE trace_spans (
  run_id TEXT NOT NULL REFERENCES trace_runs(run_id) ON DELETE CASCADE,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('run', 'step', 'model', 'tool', 'approval')),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'cancelled', 'running')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
  cache_hit INTEGER CHECK (cache_hit IS NULL OR cache_hit IN (0, 1)),
  attributes TEXT NOT NULL CHECK (json_valid(attributes)),
  PRIMARY KEY (run_id, span_id)
) STRICT;
`;

const down = `
DROP TABLE trace_spans;
DROP TABLE trace_runs;
`;

export const traces: Migration = { version: 7, name: 'traces', up, down };
