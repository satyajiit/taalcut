// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The clip page's filmstrip (UX2): what media.filmstrip stored when it finished (the sprite, its grid and its frames'
 * times, core's `Filmstrip`), while the sprite is still in the media cache. Its `derived_files` row goes the moment
 * the cache lets it go (evicted-files.ts), so the detail never names a missing sprite.
 */
import { filmstripSchema, type AssetId, type Filmstrip } from '@taalcut/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { createDerivedFileRepository } from '../repositories/derived-files';
import { assetIndexStages } from '../schema/media';

const FILMSTRIP_STAGE = 'media.filmstrip';
/** The part of media.filmstrip's stored output the detail carries. */
const outputSchema = z.object({ filmstrip: filmstripSchema });

/** The clip's filmstrip, or null until media.filmstrip made it and once the cache let the sprite go. */
export function filmstripOf(db: LibraryDatabase, id: AssetId): Filmstrip | null {
  const row = db.orm
    .select({ output: assetIndexStages.output })
    .from(assetIndexStages)
    .where(
      and(
        eq(assetIndexStages.assetId, id),
        eq(assetIndexStages.stage, FILMSTRIP_STAGE),
        eq(assetIndexStages.state, 'done'),
      ),
    )
    .get();
  const parsed = outputSchema.safeParse(row?.output);
  if (!parsed.success) return null;
  return createDerivedFileRepository(db).hasKey(parsed.data.filmstrip.file.key)
    ? parsed.data.filmstrip
    : null;
}
