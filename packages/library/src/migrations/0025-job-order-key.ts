// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Depth-first indexing (round IX, design B): a job's order key (core's `jobOrderKeySchema`) puts it among
 * queued jobs of the same priority, lower first and jobs without a key last. The indexing pipeline passes
 * each asset's import order, so one file's stages run before the next file's. The claim index follows the
 * whole claim order (priority, order key with nulls last, the time the job became runnable, id), so a
 * claim walks the index instead of sorting every queued job of its class.
 */
import type { Migration } from './types';

const up = `
ALTER TABLE jobs ADD COLUMN order_key INTEGER;
DROP INDEX jobs_claim_idx;
CREATE INDEX jobs_claim_order_idx ON jobs(state, resource_class, priority DESC, (order_key IS NULL), order_key,
  coalesce(next_run_at, created_at), id);
`;

const down = `
DROP INDEX jobs_claim_order_idx;
ALTER TABLE jobs DROP COLUMN order_key;
CREATE INDEX jobs_claim_idx ON jobs(state, resource_class, priority DESC, next_run_at);
`;

export const jobOrderKey: Migration = { version: 25, name: 'job_order_key', up, down };
