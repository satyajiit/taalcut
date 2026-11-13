// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { stat } from 'node:fs/promises';
import { parseId, type AssetId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';

/** The ledger is a hint: an absent or changed-size original must be offered for recovery. */
export async function knownAssets(db: LibraryDatabase, ids: readonly AssetId[]): Promise<Set<AssetId>> {
  const known = new Set<AssetId>();
  const query = db.driver.prepare(
    `SELECT a.id, l.absolute_path_cached AS path, a.size_bytes AS size
       FROM assets a JOIN asset_locations l ON l.asset_id=a.id
       WHERE a.id IN (SELECT value FROM json_each(?))
         AND a.trashed_at IS NULL AND a.detached_at IS NULL`,
  );
  const unique = [...new Set(ids)];
  for (let at = 0; at < unique.length; at += 5000) {
    const rows = query.all(JSON.stringify(unique.slice(at, at + 5000)));
    for (let page = 0; page < rows.length; page += 32)
      await Promise.all(
        rows.slice(page, page + 32).map(async (row) => {
          const id = parseId<'Asset'>(row.id);
          if (id.ok && !known.has(id.value) && (await presentFile(row.path, row.size))) known.add(id.value);
        }),
      );
  }
  return known;
}

export async function presentFile(path: unknown, size: unknown): Promise<boolean> {
  if (typeof path !== 'string' || typeof size !== 'number') return false;
  const file = await stat(path).catch(() => undefined);
  return Boolean(file?.isFile() && file.size === size);
}
