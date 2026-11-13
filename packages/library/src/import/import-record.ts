// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hand-off's one transaction (P2-L3, P3-B4/P3-B5): the session's source
 * (made on its first file: `wifi_import` for the phone's browser, `usb_import`
 * for a USB run, named after the device), the asset with its re-encode
 * verdict, the managed location (found via `wifi` or `usb`), a USB item's
 * import record, and `library.hash` already done, since the bytes were hashed
 * on the way in. ADR 0001 "Duplicates" decides what is new.
 */
import { newId, type AssetId, type ImportOutcome, type SourceId, type StagedImport } from '@taalcut/core';
import { and, eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { createSourceRepository } from '../repositories/sources';
import { assetLocations, assets } from '../schema/library';
import { assetKindOf } from '../sources/scan-plan';
import { insertLocation, type FileFacts } from '../sources/scan-store';
import { recordUsbImport, viaOf } from './usb-record';

export interface ImportRecord {
  readonly file: StagedImport;
  /** The originals root the session's source is rooted at. */
  readonly root: string;
  /** Relative to the root. */
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly facts: FileFacts;
  readonly contentHash: string;
  readonly partialHash: string;
  readonly volume: { readonly uuid: string | null; readonly name: string | null };
}

/** What the library already has for these bytes. */
export function duplicateOf(
  db: LibraryDatabase,
  contentHash: string,
): { readonly assetId: AssetId; readonly managedPath: string | null } | undefined {
  const asset = db.orm
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.contentHashAlg, 'blake3'), eq(assets.contentHash, contentHash)))
    .get();
  if (!asset) return undefined;
  const managed = db.orm
    .select({ path: assetLocations.absolutePathCached })
    .from(assetLocations)
    .where(and(eq(assetLocations.assetId, asset.id), eq(assetLocations.storage, 'managed')))
    .get();
  return { assetId: asset.id, managedPath: managed ? (managed.path ?? '') : null };
}

/** The session's (or USB run's) source, made on its first file and named by the phone's label. */
export function sessionSource(
  db: LibraryDatabase,
  record: Pick<ImportRecord, 'file' | 'root' | 'volume'>,
): SourceId {
  const sources = createSourceRepository(db);
  const existing = sources.findByTransferSession(record.file.sessionId);
  if (existing) return existing.id;
  const label = (record.file.source?.label ?? record.file.device?.label ?? 'Import').normalize('NFC').trim();
  const added = sources.add({
    kind: sourceKind(record.file.channel),
    displayName: label || 'Import',
    rootPath: record.root,
    transferSessionId: record.file.sessionId,
    deviceLabel: label || null,
    volumeUuid: record.volume.uuid,
    volumeName: record.volume.name,
  });
  if (!added.ok) throw new Error(`import source not added: ${added.error.code}`);
  return added.value.id;
}

/** Writes the import; returns the outcome. Runs inside the caller's transaction. */
export function recordImport(
  db: LibraryDatabase,
  record: ImportRecord,
  duplicate: ReturnType<typeof duplicateOf>,
): ImportOutcome {
  const now = db.clock();
  const sourceId = sessionSource(db, record);
  const provenance = (assetId: AssetId) => {
    db.driver
      .prepare('INSERT OR IGNORE INTO import_provenance VALUES(?,?,?,?,?,?)')
      .run(record.file.uploadId, assetId, sourceId, record.file.channel, record.file.fileName, now);
  };
  if (duplicate && duplicate.managedPath !== null) {
    db.orm
      .update(assets)
      .set({ updatedAt: now, trashedAt: null, detachedAt: null })
      .where(eq(assets.id, duplicate.assetId))
      .run();
    recordUsbImport(db, record.file, duplicate.assetId, now);
    provenance(duplicate.assetId);
    return { assetId: duplicate.assetId, sourceId, duplicate: 'already-in-library' };
  }
  const location = {
    sourceId,
    relativePath: record.relativePath,
    absolutePath: record.absolutePath,
    volumeUuid: record.volume.uuid,
    file: record.facts,
    partialHash: record.partialHash,
    fullHash: record.contentHash,
    state: 'present' as const,
    via: viaOf(record.file),
    storage: 'managed' as const,
  };
  if (duplicate) {
    // Older imports predate the provenance table. Preserve their source before replacing its location.
    db.driver
      .prepare(
        `INSERT INTO import_provenance
      SELECT ?, l.asset_id, l.source_id, COALESCE(l.via, 'legacy'), a.original_filename,
        COALESCE(l.first_seen_at, a.created_at)
      FROM asset_locations l JOIN assets a ON a.id=l.asset_id
      WHERE l.asset_id=? AND l.storage='managed' AND NOT EXISTS
        (SELECT 1 FROM import_provenance p WHERE p.asset_id=l.asset_id AND p.source_id=l.source_id)`,
      )
      .run(newId<'TransferUpload'>(), duplicate.assetId);
    // A missing managed copy must release the single-managed-location slot before its repair.
    db.orm
      .delete(assetLocations)
      .where(and(eq(assetLocations.assetId, duplicate.assetId), eq(assetLocations.storage, 'managed')))
      .run();
    insertLocation(db, duplicate.assetId, location, now);
    db.orm
      .update(assets)
      .set({ updatedAt: now, trashedAt: null, detachedAt: null })
      .where(eq(assets.id, duplicate.assetId))
      .run();
    recordUsbImport(db, record.file, duplicate.assetId, now);
    provenance(duplicate.assetId);
    return { assetId: duplicate.assetId, sourceId, duplicate: 'added-managed-copy' };
  }
  const { file } = record;
  const kind = assetKindOf(file.fileName) ?? kindOfMime(file.mimeType);
  const assetId = newId<'Asset'>() as AssetId;
  db.orm
    .insert(assets)
    .values({
      id: assetId,
      kind,
      contentHashAlg: 'blake3',
      contentHash: record.contentHash,
      partialHash: record.partialHash,
      sizeBytes: record.facts.sizeBytes,
      originalFilename: file.fileName.normalize('NFC'),
      availability: 'missing',
      createdAt: now,
      updatedAt: now,
      reencode: file.reencode.verdict,
      reencodeReasons: [...file.reencode.reasons],
    })
    .run();
  insertLocation(db, assetId, location, now);
  recordUsbImport(db, record.file, assetId, now);
  provenance(assetId);
  // The bytes were hashed on the way in: the pipeline starts after library.hash.
  db.driver
    .prepare(
      `INSERT OR REPLACE INTO asset_index_stages
         (asset_id, stage, state, version, generation, output, attempts, started_at, finished_at, updated_at)
       VALUES (?, 'library.hash', 'done', 1, 0, ?, 0, ?, ?, ?)`,
    )
    .run(assetId, JSON.stringify({ contentHash: record.contentHash }), now, now, now);
  return { assetId, sourceId, duplicate: 'none' };
}

/** The phone's MIME type when the extension says nothing (transfer sniffed the bytes). */
function kindOfMime(mime: string | null): 'video' | 'image' | 'audio' {
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('audio/')) return 'audio';
  return 'video';
}

function sourceKind(channel: StagedImport['channel']) {
  const kinds = {
    wifi: 'wifi_import',
    usb: 'usb_import',
    local: 'local_import',
    camera: 'camera_import',
    photos: 'photos_import',
  } as const;
  return kinds[channel];
}
