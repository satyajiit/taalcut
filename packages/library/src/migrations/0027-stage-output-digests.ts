// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-I3 (dependent invalidation): `asset_index_stages.output_digest`, the SHA-256 of what the stage last stored
 * for the asset that later stages read (its definition's `stores`). Written in the transaction that stores the
 * stage's result or its skip, and kept through resets: it is the identity of what is stored, which stays until the
 * stage stores again. When a run's digest differs from the one kept, the pipeline resets the stages that read this
 * one (indexing/invalidation.ts). Null on every row this migration finds: the pipeline records those digests from
 * what is stored and re-runs nothing (indexing/digest-backfill.ts).
 */
import type { Migration } from './types';

const up = `ALTER TABLE asset_index_stages ADD COLUMN output_digest TEXT;`;

const down = `ALTER TABLE asset_index_stages DROP COLUMN output_digest;`;

export const stageOutputDigests: Migration = { version: 27, name: 'stage_output_digests', up, down };
