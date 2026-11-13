// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the media cache asks the library before it evicts (UX2 rounds 3 and 4; library SPEC "UX2: the cache's cap").
 * An asset's files are held while a window shows its clip page (open-clips.ts: main keeps that list, so a restarted
 * jobs process still has it; the page closing or its window going lets them go), while the pipeline is feeding one
 * of its stages, and while one of its stage jobs is queued or running (a job reads them now or soon). Main serves a
 * clip's copy one byte range at a time, each read opening the file again, so a copy deleted mid-view would stop
 * playing: held, it is never deleted. Also: which originals are offline (ADR 0001: their files go last).
 */
import type { AssetId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { openClips } from './open-clips';

/** The job input's limit (media's `media.enforceCacheCap`). */
export const OFFLINE_HASHES_MAX = 50_000;

export interface CacheHolds {
  /** Runs the feed of one of the asset's stages: its files stay until the job is queued (and then while it is). */
  feeding<T>(assetId: AssetId, feed: () => Promise<T>): Promise<T>;
  /**
   * A window shows the asset's clip, a stage of it is being fed, or one of its stage jobs is queued or running. Read
   * now, each time. While the open clips can't be read, everything is held: main writes the list again on its next
   * change.
   */
  holds(assetId: AssetId): boolean;
}

export function createCacheHolds(db: LibraryDatabase): CacheHolds {
  const feeding = new Map<AssetId, number>();
  const active = db.driver.prepare(
    `SELECT 1 AS held FROM asset_index_stages WHERE asset_id = ? AND state IN ('queued', 'running') LIMIT 1`,
  );
  return {
    async feeding(assetId, feed) {
      feeding.set(assetId, (feeding.get(assetId) ?? 0) + 1);
      try {
        return await feed();
      } finally {
        const left = (feeding.get(assetId) ?? 1) - 1;
        if (left > 0) feeding.set(assetId, left);
        else feeding.delete(assetId);
      }
    },
    holds(assetId) {
      if (feeding.has(assetId)) return true;
      const open = openClips(db);
      if (!open.ok || open.value.has(assetId)) return true;
      return active.get(assetId) !== undefined;
    },
  };
}

/** Content hashes of the assets whose original isn't online (offline, missing, an iCloud placeholder). */
export function offlineContentHashes(db: LibraryDatabase, limit = OFFLINE_HASHES_MAX): string[] {
  const rows = db.driver
    .prepare(
      `SELECT content_hash AS hash FROM assets
       WHERE availability <> 'online' AND content_hash IS NOT NULL ORDER BY rowid LIMIT ?`,
    )
    .all(limit) as { hash: string }[];
  return rows.map((row) => row.hash);
}
