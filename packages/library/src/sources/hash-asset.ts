// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.hashAsset`, the `library.hash` index stage: reads the asset's
 * BLAKE3 from a present copy (the managed one first). When another asset
 * already has those bytes (ADR 0001, "Duplicates"), this one was a
 * provisional asset for a copy of known bytes: its locations move to that
 * asset and it is deleted, before any analysis ran (every analysis stage
 * needs `library.hash`). That asset's missing locations are then dropped:
 * the bytes were found again.
 */
import {
  defineIndexStage,
  err,
  NotFoundError,
  ok,
  stageJob,
  type AssetId,
  type AsyncResult,
  type EventBus,
  type IndexStageDefinition,
  type VectorIndex,
} from '@taalcut/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { ContentHasher } from '../hashing/content-hasher';
import type { AssetLocationId } from '../ids';
import { assetLocations, assets, sources } from '../schema/library';
import { OriginalUnavailable } from './errors';
import { hashAssetJob } from './job-kinds';
import { absolutePathOf } from './scan-store';

export interface HashAssetDeps {
  readonly db: LibraryDatabase;
  readonly hasher: ContentHasher;
  readonly events?: Pick<EventBus, 'emit'>;
  /** The active space's index: a merged-away asset's vectors go with it (normally there are none yet). */
  readonly vectors?: Pick<VectorIndex, 'removeWhere'>;
}

/** The present copies of an asset, managed first, as absolute paths. */
function presentCopies(db: LibraryDatabase, assetId: AssetId) {
  return db.orm
    .select({ location: assetLocations, rootPath: sources.rootPath })
    .from(assetLocations)
    .innerJoin(sources, eq(sources.id, assetLocations.sourceId))
    .where(and(eq(assetLocations.assetId, assetId), eq(assetLocations.state, 'present')))
    .orderBy(sql`${assetLocations.storage} = 'managed' DESC`, asc(assetLocations.id))
    .all()
    .map((row) => ({ ...row.location, path: absolutePathOf(row.rootPath, row.location.relativePath) }));
}

export async function hashAsset(
  deps: HashAssetDeps,
  input: { readonly assetId: AssetId; readonly generation: number },
  signal?: AbortSignal,
): AsyncResult<{ contentHash: string; merged?: AssetId }> {
  const { db } = deps;
  const asset = db.orm.select().from(assets).where(eq(assets.id, input.assetId)).get();
  if (!asset) return err(NotFoundError({ entity: 'asset', id: input.assetId }));
  if (asset.contentHash) return ok({ contentHash: asset.contentHash });
  const copies = presentCopies(db, asset.id);
  let hashed: { contentHash: string; partialHash: string | null; locationId: AssetLocationId } | undefined;
  for (const copy of copies) {
    const full = await deps.hasher.full(copy.path, signal ? { signal } : {});
    if (!full.ok) {
      if (full.error.code === 'core.cancelled') return full;
      continue; // Gone since the scan: try the next copy.
    }
    const partial = asset.partialHash ? null : await deps.hasher.partial(copy.path);
    hashed = {
      contentHash: full.value,
      partialHash: partial?.ok ? partial.value : asset.partialHash,
      locationId: copy.id,
    };
    break;
  }
  if (!hashed) return err(OriginalUnavailable({ name: asset.originalFilename }));
  const { contentHash, partialHash, locationId } = hashed;

  const merged = db.transaction(() => {
    const now = db.clock();
    const same = db.orm
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.contentHashAlg, 'blake3'), eq(assets.contentHash, contentHash)))
      .get();
    if (!same || same.id === asset.id) {
      db.orm
        .update(assets)
        .set({ contentHashAlg: 'blake3', contentHash, partialHash, updatedAt: now })
        .where(eq(assets.id, asset.id))
        .run();
      db.orm
        .update(assetLocations)
        .set({ fullHash: contentHash })
        .where(eq(assetLocations.id, locationId))
        .run();
      return undefined;
    }
    mergeInto(db, asset.id, same.id, contentHash);
    deps.vectors?.removeWhere({ assetId: asset.id });
    return same.id;
  });
  if (deps.events) {
    deps.events.emit('library.changed', {
      projectId: null,
      entity: 'asset',
      change: merged ? 'deleted' : 'updated',
      ids: [asset.id],
    });
    if (merged)
      deps.events.emit('library.changed', {
        projectId: null,
        entity: 'asset',
        change: 'updated',
        ids: [merged],
      });
  }
  return ok(merged ? { contentHash, merged } : { contentHash });
}

/**
 * Moves every location of `from` onto `to` (the asset that already has these bytes) and deletes
 * `from`. A location `to` already has at the same place, or a second managed copy, is dropped
 * instead of moved (its file stays where it is). Then `to`'s missing locations go.
 */
export function mergeInto(db: LibraryDatabase, from: AssetId, to: AssetId, contentHash: string): void {
  const theirs = db.orm.select().from(assetLocations).where(eq(assetLocations.assetId, to)).all();
  const hasManaged = theirs.some((l) => l.storage === 'managed');
  const taken = new Set(theirs.map((l) => `${l.sourceId}\u0000${l.relativePath}`));
  const ours = db.orm.select().from(assetLocations).where(eq(assetLocations.assetId, from)).all();
  const drop: AssetLocationId[] = [];
  for (const location of ours) {
    const clash =
      taken.has(`${location.sourceId}\u0000${location.relativePath}`) ||
      (location.storage === 'managed' && hasManaged);
    if (clash) {
      drop.push(location.id);
      continue;
    }
    db.orm
      .update(assetLocations)
      .set({ assetId: to, fullHash: contentHash })
      .where(eq(assetLocations.id, location.id))
      .run();
  }
  if (drop.length > 0) db.orm.delete(assetLocations).where(inArray(assetLocations.id, drop)).run();
  db.orm.delete(assets).where(eq(assets.id, from)).run();
  // The bytes were found again: the old paths that are gone stop being "missing files".
  if (ours.length > drop.length) {
    db.orm
      .delete(assetLocations)
      .where(and(eq(assetLocations.assetId, to), eq(assetLocations.state, 'missing')))
      .run();
  }
  db.orm.update(assets).set({ updatedAt: db.clock() }).where(eq(assets.id, to)).run();
}

/** The `library.hash` index stage: every other stage needs it (ADR 0001 identity before analysis). */
export const libraryHashStage: IndexStageDefinition = defineIndexStage({
  stage: 'library.hash',
  version: 1,
  // Its output is the asset's identity (its BLAKE3, on the asset itself): no later stage reads it from this row.
  reads: [],
  needs: [],
  appliesTo: ['video', 'image', 'audio', 'live_photo'],
  priority: 'normal',
  milestone: 'searchable',
  job: (view) => stageJob(hashAssetJob, { assetId: view.assetId, generation: view.generation }),
  result: () => ok({}),
});
