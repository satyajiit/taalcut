// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PROVISIONAL repository for AssetLocation, per ADR 0001 (decision
 * D4 awaits PO approval). Every location write re-derives the asset's
 * availability through triggers, inside the same transaction.
 */
import { err, newId, ok, ValidationError, type AssetId, type Result, type SourceId } from '@taalcut/core';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { AssetLocationId } from '../ids';
import { assetLocations, type AssetStorage, type LocationState } from '../schema/library';
import { attemptWrite, found, inTransaction, pageSize, touched } from './shared';

export type AssetLocation = typeof assetLocations.$inferSelect;

export interface AssetLocationAdd {
  readonly id?: AssetLocationId;
  readonly assetId: AssetId;
  readonly sourceId: SourceId;
  readonly storage: AssetStorage;
  /** Relative to the source's root path. */
  readonly relativePath: string;
  readonly absolutePathCached?: string | null;
  readonly volumeUuid?: string | null;
  readonly partialHash?: string | null;
  readonly fullHash?: string | null;
  readonly sizeBytes: number;
  readonly mtimeMs?: number | null;
  readonly state: LocationState;
}

export type AssetLocationScan = Partial<
  Pick<
    AssetLocationAdd,
    'absolutePathCached' | 'volumeUuid' | 'partialHash' | 'fullHash' | 'sizeBytes' | 'mtimeMs'
  >
>;

export interface AssetLocationRepository {
  /** Conflict for the same (asset, source, path), or a second managed copy of an asset. */
  add(input: AssetLocationAdd): Result<AssetLocation>;
  get(id: AssetLocationId): Result<AssetLocation>;
  listByAsset(assetId: AssetId): AssetLocation[];
  listBySource(sourceId: SourceId, options?: { afterId?: AssetLocationId; limit?: number }): AssetLocation[];
  /** Relink candidates by partial hash. Confirm with the full BLAKE3 before retargeting. */
  findByPartialHash(partialHash: string): AssetLocation[];
  setState(id: AssetLocationId, state: LocationState): Result<AssetLocation>;
  /** e.g. a volume was ejected: every location on it goes offline. Returns how many changed. */
  setStateOnVolume(volumeUuid: string, state: LocationState): Result<number>;
  /** Points a location at where the file is now, and marks it present. */
  relink(
    id: AssetLocationId,
    to: {
      relativePath: string;
      sourceId?: SourceId;
      absolutePathCached?: string | null;
      volumeUuid?: string | null;
    },
  ): Result<AssetLocation>;
  /** Records what a rescan saw (size, mtime, hashes, cached path). */
  recordScan(id: AssetLocationId, scan: AssetLocationScan): Result<AssetLocation>;
  remove(id: AssetLocationId): Result<void>;
}

/**
 * The path in its stored form: '/'-separated, without '.' or empty segments. Rejects an empty or
 * absolute path (`/x`, `\\x`, `C:x`), a NUL, and any '..' segment ('/' or '\\' separated), so a
 * location can never point outside its source's root.
 */
export function normaliseRelativePath(path: string): Result<string> {
  const invalid = err(ValidationError({ field: 'relativePath' }));
  if (!path || /^[/\\]|^[A-Za-z]:|\0/.test(path)) return invalid;
  if (path.split(/[/\\]/).includes('..')) return invalid;
  const normal = path
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/');
  return normal ? ok(normal) : invalid;
}

export function createAssetLocationRepository(db: LibraryDatabase): AssetLocationRepository {
  const { orm } = db;
  const get = (id: AssetLocationId) =>
    found(orm.select().from(assetLocations).where(eq(assetLocations.id, id)).get(), 'asset_location', id);
  const set = (id: AssetLocationId, changes: Partial<AssetLocation>) =>
    inTransaction(db, 'asset_location', () =>
      found(
        orm.update(assetLocations).set(changes).where(eq(assetLocations.id, id)).returning().get(),
        'asset_location',
        id,
      ),
    );
  return {
    add(input) {
      const relative = normaliseRelativePath(input.relativePath);
      if (!relative.ok) return relative;
      const row: typeof assetLocations.$inferInsert = {
        id: input.id ?? (newId<'AssetLocation'>() as AssetLocationId),
        assetId: input.assetId,
        sourceId: input.sourceId,
        storage: input.storage,
        relativePath: relative.value,
        absolutePathCached: input.absolutePathCached ?? null,
        volumeUuid: input.volumeUuid ?? null,
        partialHash: input.partialHash ?? null,
        fullHash: input.fullHash ?? null,
        sizeBytes: input.sizeBytes,
        mtimeMs: input.mtimeMs ?? null,
        state: input.state,
      };
      return attemptWrite(db, 'asset_location', () =>
        orm.insert(assetLocations).values(row).returning().get(),
      );
    },
    get,
    listByAsset: (assetId) =>
      orm
        .select()
        .from(assetLocations)
        .where(eq(assetLocations.assetId, assetId))
        .orderBy(asc(assetLocations.id))
        .all(),
    listBySource: (sourceId, options = {}) =>
      orm
        .select()
        .from(assetLocations)
        .where(
          and(
            eq(assetLocations.sourceId, sourceId),
            options.afterId ? gt(assetLocations.id, options.afterId) : undefined,
          ),
        )
        .orderBy(asc(assetLocations.id))
        .limit(pageSize(options.limit, 500, 5000))
        .all(),
    findByPartialHash: (partialHash) =>
      orm
        .select()
        .from(assetLocations)
        .where(eq(assetLocations.partialHash, partialHash))
        .orderBy(asc(assetLocations.id))
        .all(),
    setState: (id, state) => set(id, { state }),
    setStateOnVolume: (volumeUuid, state) =>
      inTransaction(db, 'asset_location', () =>
        ok(
          orm.update(assetLocations).set({ state }).where(eq(assetLocations.volumeUuid, volumeUuid)).run()
            .changes,
        ),
      ),
    relink(id, to) {
      const relative = normaliseRelativePath(to.relativePath);
      if (!relative.ok) return relative;
      const changes: Partial<AssetLocation> = { relativePath: relative.value, state: 'present' };
      if (to.sourceId !== undefined) changes.sourceId = to.sourceId;
      if (to.absolutePathCached !== undefined) changes.absolutePathCached = to.absolutePathCached;
      if (to.volumeUuid !== undefined) changes.volumeUuid = to.volumeUuid;
      return set(id, changes);
    },
    recordScan(id, scan) {
      const changes = Object.fromEntries(Object.entries(scan).filter(([, v]) => v !== undefined));
      return Object.keys(changes).length === 0 ? get(id) : set(id, changes);
    },
    remove: (id) =>
      inTransaction(db, 'asset_location', () =>
        touched(
          orm.delete(assetLocations).where(eq(assetLocations.id, id)).run().changes,
          'asset_location',
          id,
        ),
      ),
  };
}
