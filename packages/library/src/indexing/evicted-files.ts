// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Files the media cache let go (UX2; `media.derivedEvicted`, library SPEC "UX2: the filmstrip and eviction"). The
 * moment media evicts them their `derived_files` rows go, so nothing the library hands out names a missing file: the
 * asset detail's `playback` and `filmstrip` read null, the waveform, thumbnail and still with them. The stage that
 * made each file (the finished row whose stored output names its key) stays done, since the analysis did finish, and
 * carries `library.stage.fileEvicted`: nothing makes the file again yet, which would only fill the cache back up.
 * When someone opens the clip (`indexing.prioritise`), those stages go back to waiting at high priority, ahead of
 * background work, and the clip page shows them being made like any stage. Their finished jobs give up their
 * idempotency keys first: a job whose output names a file that is gone can't stand in for the new run. A stage made
 * anew drops the reason.
 *
 * Round 3 (the cache's cap): the cache asks before each file goes (`release`), and the rows go then, file by file,
 * unless the clip still needs it (cache-holds.ts); the run's `media.derivedEvicted` finds them gone. A stage about to
 * run that reads one of those stages (the filmstrip reads the proxy) has it made again first (`remakeReads`).
 */
import { ok, type AssetId, type Result } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createDerivedFileRepository } from '../repositories/derived-files';
import { inTransaction } from '../repositories/shared';
import { createStageRows } from './stage-rows';

/** A finished stage whose file the media cache let go: it is made again when its clip is next opened. */
export const FILE_EVICTED = 'library.stage.fileEvicted';

export interface EvictedFiles {
  /** The cache evicted these keys: their rows go and the stages that made them are marked. Returns their assets. */
  evicted(keys: readonly string[]): Result<AssetId[]>;
  /** These clips were opened: their marked stages wait again, at high priority. Returns the assets that had any. */
  remake(assetIds: readonly AssetId[]): AssetId[];
  /**
   * The cache is about to delete this key: unless `held` says its asset still needs it, its row goes and the stage
   * that made it is marked now. `released` false keeps the file; `assetId` names the asset that let one go.
   */
  release(
    key: string,
    held: (assetId: AssetId) => boolean,
  ): Result<{ readonly released: boolean; readonly assetId?: AssetId }>;
  /** A stage of this asset is about to run: those of `reads` whose file was let go wait again. True when any did. */
  remakeReads(assetId: AssetId, reads: readonly string[]): boolean;
}

/** A row's shape as SQLite returns it (a type, not an interface, so a row converts to it). */
type MarkedRow = { assetId: AssetId; stage: string; jobId: string | null };

export function createEvictedFiles(db: LibraryDatabase): EvictedFiles {
  const files = createDerivedFileRepository(db);
  const rows = createStageRows(db);
  const mark = db.driver.prepare(
    `UPDATE asset_index_stages AS x SET reason_key = ?, updated_at = ?
     WHERE x.asset_id = ? AND x.state = 'done' AND x.output IS NOT NULL AND instr(x.output, ?) > 0`,
  );
  const marked = db.driver.prepare(
    `SELECT asset_id AS assetId, stage, job_id AS jobId FROM asset_index_stages
     WHERE asset_id IN (SELECT value FROM json_each(?)) AND state = 'done' AND reason_key = ?`,
  );
  const markedReads = db.driver.prepare(
    `SELECT asset_id AS assetId, stage, job_id AS jobId FROM asset_index_stages
     WHERE asset_id = ? AND stage IN (SELECT value FROM json_each(?)) AND state = 'done' AND reason_key = ?`,
  );
  const retire = db.driver.prepare(
    `UPDATE jobs SET idempotency_key = NULL, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))`,
  );

  /** Their finished jobs give up their keys, and the stages wait again (at `priority`, else their own). */
  function remakeRows(found: readonly MarkedRow[], priority?: 'high'): AssetId[] {
    const byAsset = new Map<AssetId, string[]>();
    for (const { assetId, stage } of found) byAsset.set(assetId, [...(byAsset.get(assetId) ?? []), stage]);
    const jobIds = found.flatMap((row) => (row.jobId ? [row.jobId] : []));
    db.transaction(() => {
      retire.run(db.clock(), JSON.stringify(jobIds));
      for (const [assetId, stages] of byAsset) rows.reset([assetId], stages, priority);
    });
    return [...byAsset.keys()];
  }

  function evicted(keys: readonly string[]): Result<AssetId[]> {
    return inTransaction(db, 'derived_file', () => {
      const owners = new Map<string, AssetId>();
      for (const key of keys) {
        const row = files.byKey(key);
        if (row) owners.set(key, row.assetId);
      }
      const removed = files.removeKeys([...owners.keys()]);
      if (!removed.ok) return removed;
      const now = db.clock();
      for (const [key, assetId] of owners) mark.run(FILE_EVICTED, now, assetId, key);
      return ok([...new Set(owners.values())]);
    });
  }

  return {
    evicted,
    remake(assetIds) {
      if (assetIds.length === 0) return [];
      const found = marked.all(JSON.stringify(assetIds), FILE_EVICTED) as MarkedRow[];
      return found.length === 0 ? [] : remakeRows(found, 'high');
    },
    release(key, held) {
      const row = files.byKey(key);
      if (!row) return ok({ released: true });
      if (held(row.assetId)) return ok({ released: false });
      const gone = evicted([key]);
      return gone.ok ? ok({ released: true, assetId: row.assetId }) : gone;
    },
    remakeReads(assetId, reads) {
      if (reads.length === 0) return false;
      const found = markedReads.all(assetId, JSON.stringify(reads), FILE_EVICTED) as MarkedRow[];
      return found.length > 0 && remakeRows(found).length > 0;
    },
  };
}
