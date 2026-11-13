// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: the clips added to the library since a time (from this Mac or the phone, through the usual import), and
 * how many of them indexing has made searchable (`asset_index_state.searchable_at`), so casting can find them. The
 * gaps step waits on these counts after "Add more clips". Audio isn't a clip.
 */
import type { LibraryDatabase } from '../db/database';
import { USER_IMPORTED_ASSET_SQL } from './filters';

export interface ClipsAdded {
  readonly added: number;
  readonly ready: number;
}

export function clipsAddedSince(db: LibraryDatabase, since: number): ClipsAdded {
  const row = db.driver
    .prepare(
      `SELECT count(*) AS added, count(m.searchable_at) AS ready
       FROM assets a LEFT JOIN asset_index_state m ON m.asset_id = a.id
       WHERE a.created_at >= ? AND a.trashed_at IS NULL AND a.kind IN ('video', 'image', 'live_photo')
         AND ${USER_IMPORTED_ASSET_SQL}`,
    )
    .get(since);
  return { added: Number(row?.added ?? 0), ready: Number(row?.ready ?? 0) };
}
