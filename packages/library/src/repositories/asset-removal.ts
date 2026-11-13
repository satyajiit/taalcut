// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Deleting assets for good (`library.collect`, a duplicate merged away by the
 * hash stage): the rows, everything that cascades from them (locations,
 * shots, transcripts, derived-file rows, stage rows) and their vectors, in one
 * transaction. The vec0 table lives in the same database, so a crash can't
 * leave vectors pointing at an asset that is gone, or the reverse.
 */
import { ok, type AssetId, type Result, type VectorIndex } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { inTransaction } from './shared';

/** sqlite-vec filters take lists; keep each statement's list short. */
const CHUNK = 500;

/** Deletes the assets and, given the active space's index, their vectors. Returns how many assets went. */
export function removeAssets(
  db: LibraryDatabase,
  ids: readonly AssetId[],
  vectors?: Pick<VectorIndex, 'removeWhere'>,
): Result<number> {
  if (ids.length === 0) return ok(0);
  return inTransaction(db, 'asset', () => {
    let removed = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      if (vectors) {
        const gone = vectors.removeWhere({ assetId: chunk });
        if (!gone.ok) return gone;
      }
      removed += db.driver
        .prepare('DELETE FROM assets WHERE id IN (SELECT value FROM json_each(?))')
        .run(JSON.stringify(chunk)).changes;
    }
    return ok(removed);
  });
}
