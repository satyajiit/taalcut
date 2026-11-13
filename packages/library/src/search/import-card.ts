// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The cards the library's tools show in place of their tool rows (core's
 * `resultCard`): `importProgress` for `library.importStatus` (one source's
 * import with its newest thumbnails) and `sourcePicker` for
 * `library.listSources`. A card's id is stable per source, so a later status
 * replaces the earlier card instead of stacking a new one.
 */
import { importStatusSchema, type Card, type SourceView, type ToolCardContext } from '@taalcut/core';
import type { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { toDerivedRef } from '../repositories/derived-files';
import { assetLocations } from '../schema/library';
import { derivedFiles } from '../schema/media';
import type { toolIndexingStatusSchema } from './tool-schemas';

const THUMBNAILS = 8;

/** The source's newest asset thumbnails (JPEGs), newest first. */
function newestThumbnails(db: LibraryDatabase, sourceId: string) {
  return db.orm
    .selectDistinct({ file: derivedFiles })
    .from(derivedFiles)
    .innerJoin(assetLocations, eq(assetLocations.assetId, derivedFiles.assetId))
    .where(
      and(
        eq(assetLocations.sourceId, sourceId as never),
        eq(derivedFiles.kind, 'thumbnail'),
        eq(derivedFiles.mimeType, 'image/jpeg'),
        isNull(derivedFiles.shotId),
      ),
    )
    .orderBy(desc(derivedFiles.createdAt), desc(derivedFiles.key))
    .limit(THUMBNAILS)
    .all()
    .map((row) => toDerivedRef(row.file));
}

/** One source's importProgress card (the tool's output, back in core's shape): the asked-for source, or the only one. */
export function importProgressCard(
  db: LibraryDatabase,
  status: z.output<typeof toolIndexingStatusSchema>,
  ctx: ToolCardContext,
): Card | undefined {
  const only = status.sources.length === 1 ? importStatusSchema.safeParse(status.sources[0]) : undefined;
  if (!only?.success) return undefined;
  const source = only.data;
  return {
    type: 'importProgress',
    id: `importProgress:${source.sourceId}`,
    version: 1,
    runId: ctx.runId,
    sourceId: source.sourceId,
    status: source,
    thumbnails: newestThumbnails(db, source.sourceId),
  };
}

/** The sourcePicker card: shown only when the library has no indexed assets yet. */
export function sourcePickerCard(sources: readonly SourceView[], ctx: ToolCardContext): Card | undefined {
  const totalAssets = sources.reduce((sum, source) => sum + source.assets, 0);
  if (totalAssets > 0) return undefined;
  return {
    type: 'sourcePicker',
    id: `sourcePicker:${ctx.runId}`,
    version: 1,
    runId: ctx.runId,
    sources: sources.slice(0, 200),
    offers: ['folder', 'phone'],
    status: 'pending',
  };
}
