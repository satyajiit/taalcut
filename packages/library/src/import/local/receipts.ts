// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { AssetId } from '@taalcut/core';
import type { LibraryDatabase } from '../../db/database';
import { presentFile } from '../known-assets';
import type { CaptureArchive } from './archive-types';
import { safeArchiveName } from './archive-identity';
import type { MediaCapturePlan } from './camera-profiles';
import type { LocalImportLocator } from './types';

type Source = Pick<LocalImportLocator, 'sourceVolume' | 'sourceMount'>;

/** An unchanged source selection can reuse a receipt; changed members or required companions cannot. */
function fingerprint(capture: MediaCapturePlan, source: Source) {
  const files = capture.files.map((file) => [
    source.sourceVolume ?? '',
    source.sourceMount ? relative(source.sourceMount, file.path) : file.path,
    file.sizeBytes,
    file.modifiedAt,
    file.fileId,
  ]);
  files.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha256')
    .update(JSON.stringify([files, [...capture.requiredNames].sort(), capture.completeness]))
    .digest('hex');
}

export function recordLocalImportReceipt(
  db: LibraryDatabase,
  locator: LocalImportLocator,
  assetIds: readonly AssetId[],
  archiveId?: string,
) {
  db.driver
    .prepare(
      `INSERT INTO local_import_receipts (fingerprint, asset_ids, archive_id, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET asset_ids=excluded.asset_ids,
      archive_id=excluded.archive_id, updated_at=excluded.updated_at`,
    )
    .run(
      fingerprint(locator.capture, locator),
      JSON.stringify([...new Set(assetIds)]),
      archiveId ?? null,
      db.clock(),
    );
}

/** The ledger is only a hint. Missing originals must be selectable for recovery, including raw captures. */
export async function knownLocalCapture(
  db: LibraryDatabase,
  capture: MediaCapturePlan,
  source: Source,
): Promise<boolean> {
  const saved = db.driver
    .prepare('SELECT asset_ids, archive_id FROM local_import_receipts WHERE fingerprint = ?')
    .get(fingerprint(capture, source));
  if (saved) {
    const ids = JSON.parse(String(saved.asset_ids)) as AssetId[];
    if (ids.length && !(await knownManagedAssets(db, ids))) return false;
    if (typeof saved.archive_id === 'string') return knownArchive(db, saved.archive_id);
    return ids.length > 0;
  }
  // Referenced originals already have their source path in the library; every selected original must match.
  const originals = capture.files.filter((file) => !capture.optionalNames.includes(file.name));
  if (capture.disposition === 'archive' || !originals.length) return false;
  return originals.every((file) =>
    Boolean(
      db.driver
        .prepare(
          `SELECT l.id FROM asset_locations l JOIN assets a ON a.id=l.asset_id
          WHERE l.absolute_path_cached=? AND l.size_bytes=? AND l.mtime_ms=? AND l.state='present'
          AND a.trashed_at IS NULL AND a.detached_at IS NULL LIMIT 1`,
        )
        .get(file.path, file.sizeBytes, Math.round(file.modifiedAt)),
    ),
  );
}

async function knownManagedAssets(db: LibraryDatabase, ids: readonly AssetId[]): Promise<boolean> {
  const rows = db.driver
    .prepare(
      `SELECT a.id, l.absolute_path_cached AS path, a.size_bytes AS size
      FROM assets a JOIN asset_locations l ON l.asset_id=a.id
      WHERE a.id IN (SELECT value FROM json_each(?)) AND l.storage='managed'
      AND a.trashed_at IS NULL AND a.detached_at IS NULL`,
    )
    .all(JSON.stringify(ids));
  const present = new Set<string>();
  for (const row of rows) if (await presentFile(row.path, row.size)) present.add(String(row.id));
  return ids.every((id) => present.has(id));
}

async function knownArchive(db: LibraryDatabase, id: string): Promise<boolean> {
  const row = db.driver.prepare('SELECT manifest FROM capture_archives WHERE id=?').get(id);
  if (!row) return false;
  try {
    const archive = JSON.parse(String(row.manifest)) as CaptureArchive;
    if (archive.completeness !== 'complete' || !archive.members.length) return false;
    for (const member of archive.members) {
      if (!safeArchiveName(member.name)) return false;
      const path = join(archive.directory, member.name);
      const info = await lstat(path);
      if (!info.isFile() || info.size !== member.sizeBytes) return false;
    }
    return archive.requiredNames.every((name) => archive.members.some((member) => member.name === name));
  } catch {
    return false;
  }
}
