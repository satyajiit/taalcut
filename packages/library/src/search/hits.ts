// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * From fused shots to search hits: filters in SQL after fusion (with the
 * library's defaults: best takes only, trash, detached assets and Live Photo
 * movie halves hidden), the relative score cut, at most a few shots per asset,
 * then each hit's shot and asset summary and snippet.
 */
import type { AssetId, LibraryFilters, SearchHit, ShotId } from '@taalcut/core';
import { inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { filterSql } from '../profile/filters';
import { assetSummaries, shotSummaries } from '../profile/summaries';
import { createShotRepository } from '../repositories/shots';
import { assets } from '../schema/library';
import { MATCH_KIND_OF, type FusedShot } from './fusion/lists';
import type { SearchFusion } from './fusion/versions';
import type { Snippet } from './fts';

/** The candidates that pass the filters, in the given order. */
export function allowedShots(
  db: LibraryDatabase,
  candidates: readonly ShotId[],
  filters: LibraryFilters | undefined,
): Set<ShotId> {
  if (candidates.length === 0) return new Set();
  const where = filterSql(filters, 'shot');
  const rows = db.driver
    .prepare(
      `SELECT s.id AS id FROM shots s JOIN assets a ON a.id = s.asset_id
       WHERE s.id IN (SELECT value FROM json_each(?)) AND ${where.where}`,
    )
    .all(JSON.stringify(candidates), ...where.params);
  return new Set(rows.map((r) => r.id as ShotId));
}

export interface RankOptions {
  readonly filters?: LibraryFilters;
  readonly limit: number;
  /** Shots never to return (find similar: the shot, its group, maybe its asset). */
  readonly exclude?: (shot: { readonly id: ShotId; readonly assetId: AssetId }) => boolean;
}

export interface Ranked {
  readonly picked: FusedShot[];
  /** Filters (not the score cut) left fewer than asked: a wider kNN may find more. */
  readonly short: boolean;
}

/** Filters, cuts and caps the fused shots. */
export function rankShots(
  db: LibraryDatabase,
  fused: readonly FusedShot[],
  fusion: SearchFusion,
  options: RankOptions,
): Ranked {
  const allowed = allowedShots(
    db,
    fused.map((f) => f.shotId),
    options.filters,
  );
  const owners = new Map(
    createShotRepository(db)
      .getMany([...allowed])
      .map((s) => [s.id, s.assetId]),
  );
  const passing = fused.filter((f) => {
    const assetId = owners.get(f.shotId);
    return assetId !== undefined && !options.exclude?.({ id: f.shotId, assetId });
  });
  const top = passing[0]?.score ?? 0;
  const perAsset = new Map<AssetId, number>();
  const picked: FusedShot[] = [];
  for (const shot of passing) {
    if (picked.length >= options.limit || shot.score < top * fusion.minRelativeScore) break;
    const assetId = owners.get(shot.shotId)!;
    const count = perAsset.get(assetId) ?? 0;
    if (count >= fusion.perAssetLimit) continue;
    perAsset.set(assetId, count + 1);
    picked.push(shot);
  }
  return { picked, short: passing.length < options.limit };
}

/** The hits for picked shots, in order. */
export function buildHits(
  db: LibraryDatabase,
  picked: readonly FusedShot[],
  snippetOf: ReadonlyMap<ShotId, Snippet> = new Map(),
): SearchHit[] {
  if (picked.length === 0) return [];
  const shots = createShotRepository(db).getMany(picked.map((p) => p.shotId));
  const shotSummary = shotSummaries(db, shots);
  const assetIds = [...new Set(shots.map((s) => s.assetId))];
  const rows = db.orm.select().from(assets).where(inArray(assets.id, assetIds)).all();
  const assetSummary = new Map(assetSummaries(db, rows).map((a) => [a.id, a]));
  const hits: SearchHit[] = [];
  for (const { shotId, score, matchedBy } of picked) {
    const shot = shotSummary.get(shotId);
    const asset = shot && assetSummary.get(shot.assetId);
    if (!shot || !asset) continue;
    const snippet = snippetOf.get(shotId);
    hits.push({
      shot,
      asset,
      score: Math.round(score * 1e6) / 1e6,
      matchedBy: [...new Set(matchedBy.map((list) => MATCH_KIND_OF[list]))],
      ...(snippet ? { snippet } : {}),
    });
  }
  return hits;
}
