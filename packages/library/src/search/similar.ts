// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Find similar" (P2-L10): the shot's own vectors are the queries, its frames
 * (averaged) against other frames and its description against other
 * descriptions, fused like search. The shot, its near-duplicate group and (by
 * default) the rest of its asset are left out before ranking, so the first
 * other shot ranks first. No keywords and no embedder call.
 */
import {
  ok,
  type LibraryFilters,
  type Result,
  type ShotId,
  type VectorIndex,
  type VectorMatch,
  type VectorMetric,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createShotRepository } from '../repositories/shots';
import type { FusedShot, ListMatch, MatchLists } from './fusion/lists';
import type { SearchFusion } from './fusion/versions';
import { rankShots } from './hits';
import { shotOfItem, similarityOf } from './vector-lists';

/** Vision embeds at most 8 frames per shot (vision SPEC, "What gets embedded"). */
const MAX_FRAMES = 8;

export interface SimilarInput {
  readonly shotId: ShotId;
  readonly filters?: LibraryFilters;
  readonly limit: number;
  readonly excludeSameAsset: boolean;
}

/** The unit mean of the vectors (their direction), or null when there are none. */
export function meanVector(vectors: readonly Float32Array[]): Float32Array | null {
  const first = vectors[0];
  if (!first) return null;
  const mean = new Float32Array(first.length);
  for (const vector of vectors) for (let i = 0; i < mean.length; i++) mean[i]! += vector[i]!;
  let norm = 0;
  for (const v of mean) norm += v * v;
  if (norm === 0) return first;
  const scale = 1 / Math.sqrt(norm);
  for (let i = 0; i < mean.length; i++) mean[i]! *= scale;
  return mean;
}

/** The matches as list entries for the shots they name, less the shots `skip` leaves out. */
function entriesOf(
  matches: readonly VectorMatch[],
  metric: VectorMetric,
  skip: (shotId: ShotId, match: VectorMatch) => boolean,
): ListMatch[] {
  return matches.flatMap((match) => {
    const shotId = shotOfItem(match.id)?.shotId;
    return shotId && !skip(shotId, match)
      ? [{ shotId, similarity: similarityOf(match.distance, metric) }]
      : [];
  });
}

export function findSimilarShots(
  db: LibraryDatabase,
  vectors: VectorIndex,
  fusion: SearchFusion,
  input: SimilarInput,
): Result<FusedShot[]> {
  const shots = createShotRepository(db);
  const shot = shots.get(input.shotId);
  if (!shot.ok) return shot;
  const frameIds = Array.from({ length: MAX_FRAMES }, (_, n) => `frame:${input.shotId}:${n}`);
  const own = vectors.get([...frameIds, `description:${input.shotId}`]);
  if (!own.ok) return own;
  const frame = meanVector(frameIds.flatMap((id) => own.value.get(id) ?? []));
  const description = own.value.get(`description:${input.shotId}`) ?? null;
  if (!frame && !description) return ok([]);

  const group = shot.value.duplicateGroup;
  const excluded = new Set<ShotId>([input.shotId]);
  if (group) {
    excluded.add(group);
    for (const id of db.driver.prepare('SELECT id FROM shots WHERE duplicate_group = ?').all(group))
      excluded.add(id.id as ShotId);
  }
  const skip = (shotId: ShotId, match: VectorMatch) =>
    excluded.has(shotId) || (input.excludeSameAsset && match.metadata.assetId === shot.value.assetId);

  const pass = (k: number): Result<{ fused: FusedShot[]; widen: boolean }> => {
    const lists: MatchLists = {};
    let widen = false;
    for (const [list, query] of [
      ['frame', frame],
      ['description', description],
    ] as const) {
      if (!query) continue;
      const matches = vectors.search(query, { k, filter: { kind: list } });
      if (!matches.ok) return matches;
      widen ||= matches.value.length >= k && k < fusion.maxKnn;
      lists[list] = entriesOf(matches.value, vectors.metric, skip);
    }
    return ok({ fused: fusion.similar.fuse(lists, ['frame', 'description']), widen });
  };

  let result = pass(Math.min(fusion.similarKnn, fusion.maxKnn));
  if (!result.ok) return result;
  let ranked = rankShots(db, result.value.fused, fusion, input);
  if (ranked.short && result.value.widen) {
    result = pass(Math.min(fusion.similarKnn * 4, fusion.maxKnn));
    if (!result.ok) return result;
    ranked = rankShots(db, result.value.fused, fusion, input);
  }
  return ok(ranked.picked);
}
