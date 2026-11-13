// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The 30-day purge of kept files nothing refers to (core GeneratedAssetSink), a step of `library.collect`.
 *
 * "Refers to" is a timeline's clip (timeline_asset_refs) or any mention of the asset id in a timeline's working
 * copy or one of its saved versions (a voice line not placed yet, a version the person may restore). Each run
 * first brings `unreferenced_since` up to date: cleared for what is used, set to now for what stopped being
 * used (the sink sets it when it keeps a file, so an unused take goes 30 days after it was made). Then an asset
 * unreferenced for 30 days is deleted with its vectors, and its file after the commit. An asset that also has a
 * location outside a `generated` source (the person imported the same bytes) is the library's now: it stops
 * being tracked and is never purged. A root whose drive is unplugged waits for the next run.
 */
import { rm } from 'node:fs/promises';
import { err, ok, parseId, toTaalcutError, type AssetId, type AsyncResult, type Result } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { exists } from '../files/file-presence';
import { driveOf } from './generated-paths';

export const GENERATED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface GeneratedPurgeDeps {
  readonly db: LibraryDatabase;
  /** Removes these assets' vectors (the active space's VectorIndex). */
  readonly removeVectors?: (assetIds: readonly AssetId[]) => Result<number>;
}

const BATCH = 200;
/** A ULID, as every Taalcut id is written. */
const ID_TOKEN = /[0-9A-HJKMNP-TV-Z]{26}/g;

/** Tracked assets with no clip referring to them: the only ones a document scan has to look for. */
function withoutClips(db: LibraryDatabase): Set<string> {
  const rows = db.driver
    .prepare(
      `SELECT g.asset_id FROM generated_assets g
        WHERE NOT EXISTS (SELECT 1 FROM timeline_asset_refs r WHERE r.asset_id = g.asset_id)`,
    )
    .all();
  return new Set(rows.map((row) => String(row.asset_id)));
}

/** Drops from `candidates` every id a working copy or saved version mentions; one pass, in pages. */
function dropMentioned(
  db: LibraryDatabase,
  candidates: Set<string>,
  table: 'timelines' | 'timeline_versions',
) {
  let after = '';
  while (candidates.size > 0) {
    const rows = db.driver
      .prepare(`SELECT id, document FROM ${table} WHERE id > ? ORDER BY id LIMIT ?`)
      .all(after, BATCH);
    for (const row of rows) {
      for (const token of String(row.document).match(ID_TOKEN) ?? []) candidates.delete(token);
    }
    if (rows.length < BATCH) return;
    after = String(rows.at(-1)?.id ?? '');
  }
}

/** Clears `unreferenced_since` for what is used, sets it for what newly isn't. */
function markReferences(db: LibraryDatabase, now: number): void {
  const unused = withoutClips(db);
  dropMentioned(db, unused, 'timelines');
  dropMentioned(db, unused, 'timeline_versions');
  db.transaction(() => {
    const tracked = db.driver.prepare('SELECT asset_id, unreferenced_since FROM generated_assets').all();
    const clear = db.driver.prepare(
      'UPDATE generated_assets SET unreferenced_since = NULL WHERE asset_id = ?',
    );
    const start = db.driver.prepare('UPDATE generated_assets SET unreferenced_since = ? WHERE asset_id = ?');
    for (const row of tracked) {
      const id = String(row.asset_id);
      if (!unused.has(id) && row.unreferenced_since !== null) clear.run(id);
      if (unused.has(id) && row.unreferenced_since === null) start.run(now, id);
    }
  });
}

/** Stops tracking assets that have a location outside a generated source: the library keeps them. */
function releaseAdopted(db: LibraryDatabase): void {
  db.driver
    .prepare(
      `DELETE FROM generated_assets WHERE EXISTS (
         SELECT 1 FROM asset_locations l JOIN sources s ON s.id = l.source_id
          WHERE l.asset_id = generated_assets.asset_id AND s.kind <> 'generated')`,
    )
    .run();
}

interface Due {
  readonly ids: AssetId[];
  readonly files: string[];
}

/** Assets unreferenced since before the cutoff whose drive is here, and their kept files. */
async function due(db: LibraryDatabase, cutoff: number): Promise<Due> {
  const rows = db.driver
    .prepare(
      `SELECT g.asset_id, l.absolute_path_cached AS path FROM generated_assets g
         LEFT JOIN asset_locations l ON l.asset_id = g.asset_id
        WHERE g.unreferenced_since IS NOT NULL AND g.unreferenced_since <= ?
        ORDER BY g.asset_id`,
    )
    .all(cutoff);
  const offline = new Set<string>();
  const byAsset = new Map<string, string[]>();
  for (const row of rows) {
    const id = String(row.asset_id);
    const files = byAsset.get(id) ?? [];
    byAsset.set(id, files);
    if (typeof row.path !== 'string') continue;
    const drive = driveOf(row.path);
    if (drive && !(await exists(drive))) offline.add(id);
    files.push(row.path);
  }
  const ids: AssetId[] = [];
  for (const id of byAsset.keys()) {
    const parsed = parseId<'Asset'>(id);
    if (parsed.ok && !offline.has(id)) ids.push(parsed.value);
  }
  return { ids, files: ids.flatMap((id) => byAsset.get(id) ?? []) };
}

/** One collect step: returns how many assets went and how many vectors with them. */
export async function purgeGenerated(
  deps: GeneratedPurgeDeps,
): AsyncResult<{ readonly assets: number; readonly vectors: number }> {
  const { db } = deps;
  try {
    const now = db.clock();
    releaseAdopted(db);
    markReferences(db, now);
    const { ids, files } = await due(db, now - GENERATED_RETENTION_MS);
    if (ids.length === 0) return ok({ assets: 0, vectors: 0 });
    let vectors = 0;
    let assets = 0;
    db.transaction(() => {
      const removed = deps.removeVectors?.(ids);
      if (removed?.ok) vectors = removed.value;
      const marks = ids.map(() => '?').join(', ');
      // A clip added since the marking keeps its asset (the RESTRICT key would refuse the delete anyway).
      assets = db.driver
        .prepare(
          `DELETE FROM assets WHERE id IN (${marks})
             AND NOT EXISTS (SELECT 1 FROM timeline_asset_refs r WHERE r.asset_id = assets.id)`,
        )
        .run(...ids).changes;
    });
    for (const file of files) await rm(file, { force: true });
    return ok({ assets, vectors });
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}
