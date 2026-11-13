// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The sink's one transaction: the root's `generated` source (made on first use), the asset with its
 * provenance, the managed location, `library.hash` already done (the bytes were hashed on the way in, so the
 * indexing pipeline starts at the probe like a phone import), and the generated_assets row the 30-day purge
 * reads. Runs inside the caller's transaction.
 */
import {
  err,
  ok,
  type AssetId,
  type AssetKind,
  type AssetProvenance,
  type Orientation,
  type ProjectId,
  type Result,
  type RationalTime,
  type SourceId,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createAssetRepository } from '../repositories/media-library';
import { createAssetLocationRepository } from '../repositories/asset-locations';
import { managedSource } from '../repositories/sources';
import type { StoredTime } from '../repositories/stored-time';
import { knownProject } from '../projects/known-project';
import { generatedAssets } from '../schema/generated';

export interface GeneratedRecord {
  readonly root: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly kind: AssetKind;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly contentHash: string;
  readonly partialHash: string;
  readonly provenance: AssetProvenance;
  readonly projectId: ProjectId | null;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly orientation?: Orientation | null;
  readonly duration?: StoredTime | null;
}

/** An asset with these bytes, and whether it has a copy render can read (managed, or present anywhere). */
export function keptCopyOf(
  db: LibraryDatabase,
  contentHash: string,
): { readonly assetId: AssetId; readonly readable: boolean } | undefined {
  const asset = createAssetRepository(db).findByContentHash(contentHash);
  if (!asset) return undefined;
  const readable = createAssetLocationRepository(db)
    .listByAsset(asset.id)
    .some((location) => location.storage === 'managed' || location.state === 'present');
  return { assetId: asset.id, readable };
}

function addLocation(db: LibraryDatabase, assetId: AssetId, sourceId: SourceId, record: GeneratedRecord) {
  return createAssetLocationRepository(db).add({
    assetId,
    sourceId,
    storage: 'managed',
    relativePath: record.relativePath,
    absolutePathCached: record.absolutePath,
    partialHash: record.partialHash,
    fullHash: record.contentHash,
    sizeBytes: record.sizeBytes,
    mtimeMs: record.mtimeMs,
    state: 'present',
  });
}

/** A new asset for the kept bytes. */
export function recordGenerated(db: LibraryDatabase, record: GeneratedRecord): Result<AssetId> {
  const now = db.clock();
  const source = managedSource(db, 'generated', 'Generated', record.root);
  if (!source.ok) return source;
  const created = createAssetRepository(db).create({
    kind: record.kind,
    sizeBytes: record.sizeBytes,
    originalFilename: record.fileName.normalize('NFC'),
    contentHash: record.contentHash,
    partialHash: record.partialHash,
    width: record.width ?? null,
    height: record.height ?? null,
    duration: record.duration ?? null,
  });
  if (!created.ok) return created;
  const assetId = created.value.id;
  db.driver
    .prepare('UPDATE assets SET provenance = ?, orientation = COALESCE(?, orientation) WHERE id = ?')
    .run(JSON.stringify(record.provenance), record.orientation ?? null, assetId);
  const location = addLocation(db, assetId, source.value, record);
  if (!location.ok) return location;
  db.driver
    .prepare(
      `INSERT OR REPLACE INTO asset_index_stages
         (asset_id, stage, state, version, generation, output, attempts, started_at, finished_at, updated_at)
       VALUES (?, 'library.hash', 'done', 1, 0, ?, 0, ?, ?, ?)`,
    )
    .run(assetId, JSON.stringify({ contentHash: record.contentHash }), now, now, now);
  // Human recordings remain in the library even when a take is not on a timeline.
  if (record.provenance.kind !== 'captured')
    db.orm
      .insert(generatedAssets)
      .values({
        assetId,
        projectId: knownProject(db, record.projectId),
        createdAt: now,
        unreferencedSince: now,
      })
      .run();
  return ok(assetId);
}

/** Bytes the library had without a readable copy (an offline or missing original): the kept file becomes one. */
export function addKeptCopy(db: LibraryDatabase, assetId: AssetId, record: GeneratedRecord): Result<AssetId> {
  const source = managedSource(db, 'generated', 'Generated', record.root);
  if (!source.ok) return source;
  const location = addLocation(db, assetId, source.value, record);
  return location.ok ? ok(assetId) : err(location.error);
}

/** Handed out again: a tracked file's 30 days start over (a no-op for assets the sink never made). */
export function touchGenerated(db: LibraryDatabase, assetId: AssetId): void {
  db.driver
    .prepare(
      'UPDATE generated_assets SET unreferenced_since = ? WHERE asset_id = ? AND unreferenced_since IS NOT NULL',
    )
    .run(db.clock(), assetId);
}

/** A human take is durable, including when it de-duplicates against generated bytes. */
export function retainRecording(db: LibraryDatabase, assetId: AssetId, duration: RationalTime): void {
  db.driver.prepare('DELETE FROM generated_assets WHERE asset_id = ?').run(assetId);
  db.driver
    .prepare(
      `UPDATE assets SET duration_value = ?, duration_rate_num = ?, duration_rate_den = ?
    WHERE id = ? AND duration_value IS NULL`,
    )
    .run(duration.value, duration.rate.num, duration.rate.den, assetId);
}
