// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.collect` (daily, jobs process): deletes assets detached for 30
 * days (their source was removed and no rescan found them again) that no
 * timeline uses, with their vectors; purges generated files nothing has
 * referred to for 30 days (generated-purge.ts; counted with the assets);
 * removes vectors whose asset or shot is gone; keeps only the newest auto
 * versions of each timeline; and prunes template assets no version uses. The
 * vector, version and template parts are the stores' own, passed in.
 */
import { ok, type AssetId, type AsyncResult, type Result } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { purgeGenerated } from '../generated/generated-purge';

export const DETACHED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface CollectDeps {
  readonly db: LibraryDatabase;
  /** Removes these assets' vectors (the active space's VectorIndex `removeWhere({ assetId })`). */
  readonly removeVectors?: (assetIds: readonly AssetId[]) => Result<number>;
  /** Removes vectors whose asset or shot no longer exists. */
  readonly removeOrphanVectors?: () => Result<number>;
  /** Drops auto versions past each timeline's newest 50 (the timeline store's). */
  readonly pruneAutoVersions?: () => Result<number>;
  /** Deletes template asset files no version uses (the template store's `pruneAssets`). */
  readonly pruneTemplateAssets?: () => Result<number>;
  /** Deletes Style logos no Style has named for 7 days (the Style store's `pruneAssets`). */
  readonly pruneStyleAssets?: () => Result<number>;
}

const BATCH = 500;

export async function collect(
  deps: CollectDeps,
): AsyncResult<{ assets: number; vectors: number; autos: number; templateAssets: number; styleAssets: number }> {
  const { db } = deps;
  const cutoff = db.clock() - DETACHED_RETENTION_MS;
  let removedAssets = 0;
  let vectors = 0;
  for (;;) {
    const ids = db.driver
      .prepare(
        `SELECT id FROM assets
          WHERE detached_at IS NOT NULL AND detached_at <= ?
            AND NOT EXISTS (SELECT 1 FROM asset_locations WHERE asset_id = assets.id)
            AND NOT EXISTS (SELECT 1 FROM timeline_asset_refs WHERE asset_id = assets.id)
          ORDER BY id LIMIT ?`,
      )
      .all(cutoff, BATCH)
      .map((row) => String(row.id) as AssetId);
    if (ids.length === 0) break;
    db.transaction(() => {
      const removed = deps.removeVectors?.(ids);
      if (removed?.ok) vectors += removed.value;
      const marks = ids.map(() => '?').join(', ');
      removedAssets += db.driver.prepare(`DELETE FROM assets WHERE id IN (${marks})`).run(...ids).changes;
    });
    if (ids.length < BATCH) break;
  }
  const generated = await purgeGenerated({
    db,
    ...(deps.removeVectors ? { removeVectors: deps.removeVectors } : {}),
  });
  if (!generated.ok) return generated;
  removedAssets += generated.value.assets;
  vectors += generated.value.vectors;
  const orphans = deps.removeOrphanVectors?.();
  if (orphans?.ok) vectors += orphans.value;
  const autos = deps.pruneAutoVersions?.();
  const templateAssets = deps.pruneTemplateAssets?.();
  const styleAssets = deps.pruneStyleAssets?.();
  return ok({
    assets: removedAssets,
    vectors,
    autos: autos?.ok ? autos.value : 0,
    templateAssets: templateAssets?.ok ? templateAssets.value : 0,
    styleAssets: styleAssets?.ok ? styleAssets.value : 0,
  });
}
