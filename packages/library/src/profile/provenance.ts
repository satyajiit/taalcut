// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where an asset came from (P3-B6, P3-B7, P3-V18: captured, generated, bundled, stock), as `assets.provenance`
 * keeps it. AssetSummary carries it; render's AI inventory and Content Credentials ask for its kind per asset
 * (render's ProvenanceLookup). Migration 19 defaults the column to captured, and a value that does not parse
 * reads as captured, never as generated: only a known generated asset is declared.
 */
import {
  assetProvenanceSchema,
  CAPTURED,
  err,
  NotFoundError,
  ok,
  toTaalcutError,
  type AssetId,
  type AssetProvenance,
  type AsyncResult,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { parseJsonText } from '../db/json-text';

/** The stored column as core's provenance. */
export function provenanceOf(value: string): AssetProvenance {
  return parseJsonText(assetProvenanceSchema, value) ?? CAPTURED;
}

/** One asset's provenance kind; `core.not_found` for an asset the library doesn't have. */
export function createProvenanceLookup(
  db: LibraryDatabase,
): (assetId: AssetId) => AsyncResult<AssetProvenance['kind']> {
  return async (assetId) => {
    try {
      const row = db.driver.prepare('SELECT provenance FROM assets WHERE id = ?').get(assetId);
      if (!row || typeof row.provenance !== 'string')
        return err(NotFoundError({ entity: 'asset', id: assetId }));
      return ok(provenanceOf(row.provenance).kind);
    } catch (cause) {
      return err(toTaalcutError(cause));
    }
  };
}
