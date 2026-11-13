// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Credit lines for a set of assets. A non-empty attribution (CC-BY) is
 * required. Pexels "Video by X on Pexels" is courtesy. CC0 adds nothing.
 */
import {
  creditsSchema,
  err,
  ok,
  ValidationError,
  type AssetId,
  type Credits,
  type Result,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { pexelsCourtesy } from './licences';

export function creditsFor(db: LibraryDatabase, assetIds: readonly AssetId[]): Result<Credits> {
  const required = new Set<string>();
  const courtesy = new Set<string>();
  if (assetIds.length > 0) {
    const rows = db.driver
      .prepare(
        `SELECT licence, attribution, author FROM asset_licences
         WHERE asset_id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(assetIds));
    for (const row of rows) {
      if (typeof row.attribution === 'string' && row.attribution.length > 0) required.add(row.attribution);
      if (row.licence === 'Pexels-Licence' && typeof row.author === 'string' && row.author.length > 0) {
        courtesy.add(pexelsCourtesy(row.author));
      }
    }
  }
  const parsed = creditsSchema.safeParse({ required: [...required], courtesy: [...courtesy] });
  return parsed.success ? ok(parsed.data) : err(ValidationError({ field: 'credits' }));
}
