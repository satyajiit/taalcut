// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Asset and shot rows as the views a window gets (core's AssetSummary and
 * ShotSummary). Built for a page at a time: one query per part (shot stats,
 * first description, sources, index stages, finish lines, thumbnails) over the page's ids,
 * so a grid of 200 costs a handful of queries, not 200 × 5.
 */
import {
  CAMERA_MOTIONS,
  SHOT_TYPES,
  type AssetId,
  type AssetSummary,
  type DerivedFileRef,
  type ShotId,
  type ShotSummary,
  type SourceId,
} from '@taalcut/core';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { Asset } from '../repositories/media-library';
import { captureOffsetsOf } from '../repositories/capture-offsets';
import { toDerivedRef } from '../repositories/derived-files';
import { shotRange, type Shot } from '../repositories/shots';
import { assetDuration } from '../repositories/stored-time';
import { MODEL_MISSING_REASON } from '../indexing/model-missing';
import { ORIGINAL_OFFLINE } from '../indexing/stage-rows';
import { derivedFiles } from '../schema/media';
import { placesOf } from '../repositories/places';
import { provenanceOf } from './provenance';
import { createAssetLanguageRepository, speechField } from '../speech/asset-language';
import { heldLanguages } from '../speech/held-language';

const IN_JSON = 'IN (SELECT value FROM json_each(?))';

interface IndexCounts {
  total: number;
  done: number;
  failed: number;
  active: number;
  /** LIB1-PROG: rows waiting for their on-device model, and for the original to come back. */
  model?: number;
  original?: number;
}

/** LIB1-PROG: what holds a waiting asset; its original first, since no stage can run without the file. */
function heldBy(counts: IndexCounts): Pick<AssetSummary['index'], 'held'> {
  if ((counts.original ?? 0) > 0) return { held: 'original' };
  return (counts.model ?? 0) > 0 ? { held: 'model' } : {};
}

/**
 * The asset's indexing progress for its summary. `searchableAt` (round IX): when its searchable stages were all
 * done or skipped (stored by the pipeline, indexing/milestones.ts); `state` still says whether deeper analysis
 * carries on.
 */
export function indexState(
  counts: IndexCounts | undefined,
  searchableAt: number | null = null,
): AssetSummary['index'] {
  if (!counts || counts.total === 0) return { state: 'waiting', done: 0, total: 0, searchableAt };
  const state =
    counts.failed > 0
      ? 'failed'
      : counts.active > 0
        ? 'indexing'
        : counts.done === counts.total
          ? 'done'
          : 'waiting';
  return {
    state,
    done: counts.done,
    total: counts.total,
    searchableAt,
    ...(state === 'waiting' ? heldBy(counts) : {}),
  };
}

/** Newest thumbnail (a JPEG) per asset, or per shot when `shotIds` are given. */
function thumbnails(db: LibraryDatabase, assetIds: readonly AssetId[], shotIds?: readonly ShotId[]) {
  const rows = db.orm
    .select()
    .from(derivedFiles)
    .where(
      and(
        eq(derivedFiles.kind, 'thumbnail'),
        eq(derivedFiles.mimeType, 'image/jpeg'),
        shotIds ? inArray(derivedFiles.shotId, [...shotIds]) : isNull(derivedFiles.shotId),
        shotIds ? undefined : inArray(derivedFiles.assetId, [...assetIds]),
      ),
    )
    .orderBy(asc(derivedFiles.createdAt))
    .all();
  const byKey = new Map<string, DerivedFileRef>();
  for (const row of rows) byKey.set(shotIds ? row.shotId! : row.assetId, toDerivedRef(row));
  return byKey;
}

/** Summaries for these asset rows, in the same order. */
export function assetSummaries(db: LibraryDatabase, rows: readonly Asset[]): AssetSummary[] {
  if (rows.length === 0) return [];
  const ids = JSON.stringify(rows.map((r) => r.id));
  const all = <T>(sql: string) => db.driver.prepare(sql).all(ids) as T[];
  const stats = new Map(
    all<{ asset_id: string; n: number; q: number | null }>(
      `SELECT asset_id, COUNT(*) AS n, MAX(quality) AS q FROM shots WHERE asset_id ${IN_JSON} GROUP BY asset_id`,
    ).map((r) => [r.asset_id, r]),
  );
  const descriptions = new Map(
    all<{ asset_id: string; description: string }>(
      `SELECT asset_id, description FROM shots s WHERE asset_id ${IN_JSON} AND description IS NOT NULL
         AND index_in_asset = (SELECT MIN(index_in_asset) FROM shots t
           WHERE t.asset_id = s.asset_id AND t.description IS NOT NULL)`,
    ).map((r) => [r.asset_id, r.description]),
  );
  const sources = new Map<string, SourceId[]>();
  for (const r of all<{ asset_id: string; source_id: SourceId }>(
    `SELECT DISTINCT asset_id, source_id FROM library_asset_sources WHERE asset_id ${IN_JSON} ORDER BY source_id`,
  )) {
    const list = sources.get(r.asset_id) ?? [];
    if (list.length < 20) list.push(r.source_id);
    sources.set(r.asset_id, list);
  }
  const stages = new Map(
    all<IndexCounts & { asset_id: string }>(
      `SELECT asset_id, COUNT(*) AS total, SUM(state IN ('done', 'skipped')) AS done,
         SUM(state = 'failed') AS failed, SUM(state IN ('queued', 'running')) AS active,
         SUM(state = 'waiting' AND reason_key = '${MODEL_MISSING_REASON}') AS model,
         SUM(state = 'waiting' AND reason_key = '${ORIGINAL_OFFLINE}') AS original
       FROM asset_index_stages WHERE asset_id ${IN_JSON} GROUP BY asset_id`,
    ).map((r) => [r.asset_id, r]),
  );
  const searchable = new Map(
    all<{ asset_id: string; searchable_at: number | null }>(
      `SELECT asset_id, searchable_at FROM asset_index_state WHERE asset_id ${IN_JSON}`,
    ).map((r) => [r.asset_id, r.searchable_at]),
  );
  const thumbs = thumbnails(
    db,
    rows.map((r) => r.id),
  );
  const offsets = captureOffsetsOf(db, rows);
  const places = placesOf(
    db,
    rows.map((r) => r.id),
  );
  // LIB1-LANG: what each clip speaks, as decided or as the person set it.
  const spoken = createAssetLanguageRepository(db).many(rows.map((r) => r.id));
  // An old step's guess with no decision behind it isn't named until the clip is decided again (held-language.ts).
  const held = heldLanguages(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.originalFilename,
    capturedAt: row.captureTime,
    captureOffset: offsets.get(row.id) ?? null,
    addedAt: row.createdAt,
    duration: assetDuration(row),
    width: row.width,
    height: row.height,
    orientation: row.orientation,
    availability: row.availability,
    sourceIds: sources.get(row.id) ?? [],
    description: descriptions.get(row.id) ?? null,
    quality: stats.get(row.id)?.q ?? null,
    shotCount: stats.get(row.id)?.n ?? 0,
    language: held.has(row.id) ? null : row.language,
    ...speechField(spoken.get(row.id)),
    ...(held.get(row.id) === 'pending' ? { languagePending: true as const } : {}),
    index: indexState(stages.get(row.id), searchable.get(row.id) ?? null),
    thumbnail: thumbs.get(row.id) ?? null,
    reencode: row.reencode,
    trashed: row.trashedAt !== null,
    provenance: provenanceOf(row.provenance),
    // LIB1-PLACE: where it was shot and the trip it is part of.
    place: places.get(row.id)?.place ?? null,
    trip: places.get(row.id)?.trip ?? null,
  }));
}

const shotType = (value: string | null) =>
  value && (SHOT_TYPES as readonly string[]).includes(value) ? (value as ShotSummary['shotType']) : null;
const motion = (value: string | null) =>
  value && (CAMERA_MOTIONS as readonly string[]).includes(value) ? (value as ShotSummary['motion']) : null;

/** Summaries for these shot rows, by id. */
export function shotSummaries(db: LibraryDatabase, rows: readonly Shot[]): Map<ShotId, ShotSummary> {
  const thumbs =
    rows.length === 0
      ? new Map<string, DerivedFileRef>()
      : thumbnails(
          db,
          [],
          rows.map((r) => r.id),
        );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        assetId: row.assetId,
        index: row.indexInAsset,
        range: shotRange(row),
        description: row.description,
        shotType: shotType(row.shotType),
        motion: motion(row.motion),
        quality: row.quality,
        bestTake: row.bestTake,
        thumbnail: thumbs.get(row.id) ?? null,
      },
    ]),
  );
}
