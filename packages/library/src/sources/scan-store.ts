// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The scanner's reads and writes over sources, assets and locations (P2-L2).
 * Synchronous, like every repository: the scanner plans each file with async
 * I/O first, then applies a batch of plans in one transaction.
 */
import { newId, type AssetId, type SourceId } from '@taalcut/core';
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { AssetLocationId } from '../ids';
import {
  assetLocations,
  assets,
  sources,
  type AssetKind,
  type LocationState,
  type LocationVia,
} from '../schema/library';

export type LocationRow = typeof assetLocations.$inferSelect;

/** What the file looked like on disk when the scan saw it. */
export interface FileFacts {
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  /** The inode. */
  readonly fileId: number;
}

/** A location that may be the same bytes at a new path, with where it points now. */
export interface RelinkCandidate {
  readonly location: LocationRow;
  readonly absolutePath: string;
  readonly contentHash: string | null;
}

export function absolutePathOf(rootPath: string, relativePath: string): string {
  return rootPath.endsWith('/') ? rootPath + relativePath : `${rootPath}/${relativePath}`;
}

/** The location at this path in this source (a present one first). */
export function locationAt(
  db: LibraryDatabase,
  sourceId: SourceId,
  relativePath: string,
): LocationRow | undefined {
  return db.orm
    .select()
    .from(assetLocations)
    .where(and(eq(assetLocations.sourceId, sourceId), eq(assetLocations.relativePath, relativePath)))
    .orderBy(sql`${assetLocations.state} = 'present' DESC`, asc(assetLocations.id))
    .get();
}

/**
 * Locations holding bytes of this size and partial hash on the same volume (or both volumes
 * unknown), except placeholders, which were never read. The caller checks which ones are gone.
 */
export function relinkCandidates(
  db: LibraryDatabase,
  match: { readonly sizeBytes: number; readonly partialHash: string; readonly volumeUuid: string | null },
): RelinkCandidate[] {
  const rows = db.orm
    .select({ location: assetLocations, rootPath: sources.rootPath, contentHash: assets.contentHash })
    .from(assetLocations)
    .innerJoin(sources, eq(sources.id, assetLocations.sourceId))
    .innerJoin(assets, eq(assets.id, assetLocations.assetId))
    .where(
      and(
        eq(assetLocations.sizeBytes, match.sizeBytes),
        or(eq(assetLocations.partialHash, match.partialHash), eq(assets.partialHash, match.partialHash)),
        ne(assetLocations.state, 'icloud_placeholder'),
        match.volumeUuid === null
          ? isNull(assetLocations.volumeUuid)
          : or(eq(assetLocations.volumeUuid, match.volumeUuid), isNull(assetLocations.volumeUuid)),
      ),
    )
    .orderBy(asc(assetLocations.id))
    .limit(64)
    .all();
  return rows.map((row) => ({
    location: row.location,
    absolutePath: absolutePathOf(row.rootPath, row.location.relativePath),
    contentHash: row.contentHash,
  }));
}

/** Assets left without a location (a removed source) that may be these bytes: undo's rescan re-attaches them. */
export function detachedCandidates(
  db: LibraryDatabase,
  match: { readonly sizeBytes: number; readonly partialHash: string },
): { readonly id: AssetId; readonly contentHash: string | null }[] {
  return db.orm
    .select({ id: assets.id, contentHash: assets.contentHash })
    .from(assets)
    .where(
      and(
        isNotNull(assets.detachedAt),
        eq(assets.sizeBytes, match.sizeBytes),
        eq(assets.partialHash, match.partialHash),
      ),
    )
    .orderBy(asc(assets.id))
    .limit(64)
    .all();
}

export interface NewLocation {
  readonly sourceId: SourceId;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly volumeUuid: string | null;
  readonly file: FileFacts;
  readonly partialHash: string | null;
  readonly fullHash?: string | null;
  readonly state: LocationState;
  readonly via: LocationVia;
  readonly storage?: 'managed' | 'referenced';
}

/** A location row for an existing asset. */
export function insertLocation(
  db: LibraryDatabase,
  assetId: AssetId,
  input: NewLocation,
  now: number,
): AssetLocationId {
  const id = newId<'AssetLocation'>() as AssetLocationId;
  db.orm
    .insert(assetLocations)
    .values({
      id,
      assetId,
      sourceId: input.sourceId,
      storage: input.storage ?? 'referenced',
      relativePath: input.relativePath,
      absolutePathCached: input.absolutePath,
      volumeUuid: input.volumeUuid,
      partialHash: input.partialHash,
      fullHash: input.fullHash ?? null,
      sizeBytes: input.file.sizeBytes,
      mtimeMs: input.file.mtimeMs,
      state: input.state,
      fileId: input.file.fileId,
      firstSeenAt: now,
      lastSeenAt: now,
      missingSince: null,
      via: input.via,
    })
    .run();
  return id;
}

/** A new asset (no BLAKE3 yet: `library.hash` fills it) with its first location. */
export function insertAssetWithLocation(
  db: LibraryDatabase,
  input: NewLocation & { readonly kind: AssetKind; readonly fileName: string },
  now: number,
): AssetId {
  const id = newId<'Asset'>() as AssetId;
  db.orm
    .insert(assets)
    .values({
      id,
      kind: input.kind,
      contentHashAlg: null,
      contentHash: null,
      partialHash: input.partialHash,
      sizeBytes: input.file.sizeBytes,
      originalFilename: input.fileName.normalize('NFC'),
      availability: 'missing',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  insertLocation(db, id, input, now);
  return id;
}

/** The file is where the location says, as seen now. */
export function touchLocation(
  db: LibraryDatabase,
  id: AssetLocationId,
  seen: { readonly file: FileFacts; readonly state: LocationState; readonly partialHash?: string | null },
  now: number,
): void {
  db.orm
    .update(assetLocations)
    .set({
      sizeBytes: seen.file.sizeBytes,
      mtimeMs: seen.file.mtimeMs,
      fileId: seen.file.fileId,
      state: seen.state,
      lastSeenAt: now,
      missingSince: null,
      ...(seen.partialHash !== undefined ? { partialHash: seen.partialHash } : {}),
    })
    .where(eq(assetLocations.id, id))
    .run();
}

/** Points a location at the path its bytes moved to (ADR 0001, "Missing-file relink"). */
export function retargetLocation(
  db: LibraryDatabase,
  id: AssetLocationId,
  to: NewLocation,
  now: number,
): void {
  db.orm
    .update(assetLocations)
    .set({
      sourceId: to.sourceId,
      relativePath: to.relativePath,
      absolutePathCached: to.absolutePath,
      volumeUuid: to.volumeUuid,
      sizeBytes: to.file.sizeBytes,
      mtimeMs: to.file.mtimeMs,
      fileId: to.file.fileId,
      state: 'present',
      lastSeenAt: now,
      missingSince: null,
      via: 'relink',
      ...(to.partialHash ? { partialHash: to.partialHash } : {}),
    })
    .where(eq(assetLocations.id, id))
    .run();
}

/** Removes a location (its bytes changed in place, or merged away); an asset left without one is detached. */
export function dropLocation(
  db: LibraryDatabase,
  location: Pick<LocationRow, 'id' | 'assetId'>,
  now: number,
): void {
  db.orm.delete(assetLocations).where(eq(assetLocations.id, location.id)).run();
  db.driver
    .prepare(
      `UPDATE assets SET detached_at = ? WHERE id = ? AND detached_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM asset_locations WHERE asset_id = assets.id)`,
    )
    .run(now, location.assetId);
}

/** Marks these locations missing (the path is gone on a mounted volume); returns how many changed. */
export function markMissing(db: LibraryDatabase, ids: readonly AssetLocationId[], now: number): number {
  if (ids.length === 0) return 0;
  return db.orm
    .update(assetLocations)
    .set({ state: 'missing', missingSince: sql`coalesce(${assetLocations.missingSince}, ${now})` })
    .where(and(inArray(assetLocations.id, [...ids]), ne(assetLocations.state, 'missing')))
    .run().changes;
}

/** Locations of this source a full scan didn't see since it started: their paths are gone. */
export function markUnseenMissing(
  db: LibraryDatabase,
  sourceId: SourceId,
  since: number,
  now: number,
  recursive = true,
): number {
  return db.orm
    .update(assetLocations)
    .set({ state: 'missing', missingSince: sql`coalesce(${assetLocations.missingSince}, ${now})` })
    .where(
      and(
        eq(assetLocations.sourceId, sourceId),
        recursive ? undefined : sql`instr(${assetLocations.relativePath}, '/') = 0`,
        ne(assetLocations.state, 'missing'),
        or(isNull(assetLocations.lastSeenAt), sql`${assetLocations.lastSeenAt} < ${since}`),
      ),
    )
    .run().changes;
}

/** The locations at a path or under it (a folder that went away). */
export function locationsUnder(db: LibraryDatabase, sourceId: SourceId, relativePath: string): LocationRow[] {
  const prefix = `${relativePath}/`;
  return db.orm
    .select()
    .from(assetLocations)
    .where(
      and(
        eq(assetLocations.sourceId, sourceId),
        or(
          eq(assetLocations.relativePath, relativePath),
          sql`substr(${assetLocations.relativePath}, 1, ${prefix.length}) = ${prefix}`,
        ),
      ),
    )
    .all();
}

/** Every location of a source takes this state (its volume was ejected, or its root is gone). */
export function setSourceLocations(
  db: LibraryDatabase,
  sourceId: SourceId,
  state: 'offline' | 'missing',
  now: number,
): number {
  return db.orm
    .update(assetLocations)
    .set({
      state,
      ...(state === 'missing' ? { missingSince: sql`coalesce(${assetLocations.missingSince}, ${now})` } : {}),
    })
    .where(and(eq(assetLocations.sourceId, sourceId), ne(assetLocations.state, state)))
    .run().changes;
}

export function sourceExists(db: LibraryDatabase, sourceId: SourceId): boolean {
  return db.orm.select({ id: sources.id }).from(sources).where(eq(sources.id, sourceId)).get() !== undefined;
}
