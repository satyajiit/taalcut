// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The stage rows' output digests (migration 27, round IX3): what each stage last stored for an asset, as a
 * SHA-256. A reset keeps them (stage-rows.ts lists the columns it clears), so the next run compares with what is
 * still stored. Writing one doesn't touch `updated_at`: a digest isn't a state change the milestone sweep follows.
 */
import type { AssetId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';

const FINISHED = `state IN ('done', 'skipped')`;

export type StageDigestRows = ReturnType<typeof createStageDigestRows>;

export function createStageDigestRows(db: LibraryDatabase) {
  return {
    /** The digest each of `stages` keeps for the asset (null: none recorded; absent: no row). */
    of(assetId: AssetId, stages: readonly string[]): Map<string, string | null> {
      const rows = db.driver
        .prepare(
          `SELECT stage, output_digest AS digest FROM asset_index_stages
           WHERE asset_id = ? AND stage IN (SELECT value FROM json_each(?))`,
        )
        .all(assetId, JSON.stringify(stages)) as { stage: string; digest: string | null }[];
      return new Map(rows.map((row) => [row.stage, row.digest]));
    },

    set(assetId: AssetId, stage: string, digest: string): void {
      db.driver
        .prepare(`UPDATE asset_index_stages SET output_digest = ? WHERE asset_id = ? AND stage = ?`)
        .run(digest, assetId, stage);
    },

    /** Finished rows of `stages` with no digest yet (a library from before migration 27), for these assets. */
    missing(assetIds: readonly AssetId[], stages: readonly string[]): { assetId: AssetId; stage: string }[] {
      return db.driver
        .prepare(
          `SELECT asset_id AS assetId, stage FROM asset_index_stages
           WHERE asset_id IN (SELECT value FROM json_each(?)) AND stage IN (SELECT value FROM json_each(?))
             AND ${FINISHED} AND output_digest IS NULL`,
        )
        .all(JSON.stringify(assetIds), JSON.stringify(stages)) as { assetId: AssetId; stage: string }[];
    },

    /** Up to `limit` assets that have a finished row of `stages` with no digest. */
    assetsMissing(stages: readonly string[], limit: number): AssetId[] {
      return (
        db.driver
          .prepare(
            `SELECT DISTINCT asset_id AS id FROM asset_index_stages
             WHERE stage IN (SELECT value FROM json_each(?)) AND ${FINISHED} AND output_digest IS NULL
             LIMIT ?`,
          )
          .all(JSON.stringify(stages), limit) as { id: AssetId }[]
      ).map((row) => row.id);
    },
  };
}
