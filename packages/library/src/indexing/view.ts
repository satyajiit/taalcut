// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the library knows about an asset when a stage builds its job (core's
 * AssetIndexView): a present original (the managed copy first), its facts,
 * derived files, shots with analyses, transcript and the outputs of the
 * stages already done. Stages read the original, so with none present the
 * stage waits.
 */
import { join } from 'node:path';
import type { AssetId, AssetIndexView, SourceId } from '@taalcut/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { readFacts } from '../repositories/asset-facts';
import { createDerivedFileRepository } from '../repositories/derived-files';
import { createShotRepository, shotAnalysis, shotRange } from '../repositories/shots';
import { storedTranscript } from '../repositories/transcript-text';
import { assetLocations, assets, sources } from '../schema/library';
import { createAssetLanguageRepository } from '../speech/asset-language';
import { assetIndexStages } from '../schema/media';

export type ViewOutcome =
  | { readonly kind: 'view'; readonly view: AssetIndexView }
  /** No present original: the stage waits (offline volume, missing file, iCloud placeholder). */
  | { readonly kind: 'offline' }
  /** The asset is gone (removed, or merged into another by library.hash). */
  | { readonly kind: 'gone' };

/** The present location to read from, the managed copy first, as an absolute path and its source. */
export function presentOriginal(
  db: LibraryDatabase,
  assetId: AssetId,
): { readonly path: string; readonly sourceId: SourceId } | undefined {
  const row = db.orm
    .select({
      relativePath: assetLocations.relativePath,
      sourceId: assetLocations.sourceId,
      root: sources.rootPath,
    })
    .from(assetLocations)
    .innerJoin(sources, eq(sources.id, assetLocations.sourceId))
    .where(and(eq(assetLocations.assetId, assetId), eq(assetLocations.state, 'present')))
    // 'managed' sorts before 'referenced'.
    .orderBy(asc(assetLocations.storage), asc(assetLocations.id))
    .get();
  return row ? { path: join(row.root, row.relativePath), sourceId: row.sourceId } : undefined;
}

/**
 * The view for a stage's job. `requirePresent: false` is for reading a finished job's result: the
 * original may have gone offline since, and then `path` is empty.
 */
export function buildAssetIndexView(
  db: LibraryDatabase,
  assetId: AssetId,
  options: { readonly requirePresent?: boolean } = {},
): ViewOutcome {
  const asset = db.orm.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) return { kind: 'gone' };
  let original = presentOriginal(db, assetId);
  if (!original) {
    if (options.requirePresent !== false) return { kind: 'offline' };
    const any = db.orm
      .select({ sourceId: assetLocations.sourceId })
      .from(assetLocations)
      .where(eq(assetLocations.assetId, assetId))
      .get();
    original = { path: '', sourceId: (any?.sourceId ?? '') as SourceId };
  }
  const outputs: Record<string, unknown> = {};
  for (const row of db.orm
    .select({ stage: assetIndexStages.stage, output: assetIndexStages.output })
    .from(assetIndexStages)
    .where(and(eq(assetIndexStages.assetId, assetId), inArray(assetIndexStages.state, ['done'])))
    .all()) {
    if (row.output != null) outputs[row.stage] = row.output;
  }
  const view: AssetIndexView = {
    assetId,
    generation: asset.generation,
    kind: asset.kind,
    path: original.path,
    contentHash: asset.contentHash ?? '',
    sizeBytes: asset.sizeBytes,
    sourceId: original.sourceId,
    capturedAt: asset.captureTime,
    facts: readFacts(asset),
    derived: createDerivedFileRepository(db).forAsset(assetId),
    shots: createShotRepository(db)
      .listByAsset(assetId)
      .map((shot) => ({ shotId: shot.id, range: shotRange(shot), analysis: shotAnalysis(shot) })),
    transcript: storedTranscript(db, assetId),
    outputs,
    // LIB1-LANG: the language the person set for the clip, which audio.language obeys.
    chosenLanguage: createAssetLanguageRepository(db).get(assetId).chosen,
  };
  return { kind: 'view', view };
}
