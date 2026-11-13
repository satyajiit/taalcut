// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-asset annotated Set-of-Mark contact sheet (`vision.contactSheet`): stored in the stage's output and backed by
 * `derived_files` while the JPEG sheet remains in the media cache. Once evicted (`evicted-files.ts`), `hasKey` turns
 * false so neither `assetDetail` nor `library.getAsset` references a missing file.
 */
import { assetContactSheetSchema, type AssetContactSheet, type AssetId } from '@taalcut/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { createDerivedFileRepository } from '../repositories/derived-files';
import { assetIndexStages } from '../schema/media';

const CONTACT_SHEET_STAGE = 'vision.contactSheet';
const outputSchema = z.object({ contactSheet: assetContactSheetSchema });

/** The clip's annotated contact sheet, or null until `vision.contactSheet` finishes or after cache eviction. */
export function contactSheetOf(db: LibraryDatabase, id: AssetId): AssetContactSheet | null {
  const row = db.orm
    .select({ output: assetIndexStages.output })
    .from(assetIndexStages)
    .where(
      and(
        eq(assetIndexStages.assetId, id),
        eq(assetIndexStages.stage, CONTACT_SHEET_STAGE),
        eq(assetIndexStages.state, 'done'),
      ),
    )
    .get();
  const parsed = outputSchema.safeParse(row?.output);
  if (!parsed.success) return null;
  return createDerivedFileRepository(db).hasKey(parsed.data.contactSheet.file.key)
    ? parsed.data.contactSheet
    : null;
}
