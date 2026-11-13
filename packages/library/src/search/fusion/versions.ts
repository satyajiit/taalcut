// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Search fusion as versioned config (P2-L10): which method fuses search's lists and find similar's, which list
 * entries count (floors.ts), how transcript segments are credited to shots, and the kNN sizes. Tuned only against
 * the search eval and the ranking study (tools/evals, IX2-U1): a change ships with their numbers and a new version.
 */
import type { FusionMethod, MatchList, MatchLists, FusedShot } from './lists';
import { MATCH_LISTS } from './lists';
import { reciprocalRankFusion } from './reciprocal-rank';

/** The vector lists (every list but keywords). */
export type VectorList = Exclude<MatchList, 'keyword'>;

/** Similarity floors for the vector lists, as measured in one embedding space. */
export interface ListFloors {
  /** The vector index (embedding space) they were measured in; in any other they don't apply. */
  readonly space: string;
  /** The cosine similarity an entry needs to count, per list; a list not named counts every entry. */
  readonly similarity: Partial<Readonly<Record<VectorList, number>>>;
}

/**
 * Which shots a transcript segment's vector counts for: the shot holding the segment's start, or every shot the
 * segment overlaps.
 */
export type TranscriptCredit = 'start' | 'overlap';

export interface SearchFusion {
  /** Reported with eval numbers; bump with any change below. */
  readonly version: string;
  /** Fuses search's lists. */
  readonly method: FusionMethod;
  /** Fuses find similar's frame and description lists. */
  readonly similar: FusionMethod;
  readonly transcriptCredit: TranscriptCredit;
  /** Absent: every vector-list entry counts. */
  readonly floors?: ListFloors;
  /** The share of the query's terms a keyword hit must hold to count (0: any one term). */
  readonly keywordCoverage: number;
  /** Neighbours the one kNN fetches, and how far it may widen when filters thin the hits. */
  readonly knn: number;
  readonly maxKnn: number;
  /**
   * Find similar's neighbours per list (frames, descriptions). Smaller than `knn`: each list is its own
   * kNN, and sqlite-vec's cost grows with k.
   */
  readonly similarKnn: number;
  /** Keyword hits fused. */
  readonly keywordLimit: number;
  /** Hits scoring below this share of the top hit are dropped. */
  readonly minRelativeScore: number;
  readonly perAssetLimit: number;
}

/** v1's weights, kept for find similar (frame and description) in every version. */
export const RRF_V1 = reciprocalRankFusion({
  k: 60,
  weights: { frame: 1.0, description: 0.9, transcript: 0.7, ocr: 0.6, keyword: 0.8 },
});

export const SEARCH_FUSION_V1: SearchFusion = {
  version: 'search-fusion-v1',
  method: RRF_V1,
  similar: RRF_V1,
  transcriptCredit: 'start',
  keywordCoverage: 0,
  knn: 800,
  maxKnn: 4096,
  similarKnn: 200,
  keywordLimit: 200,
  minRelativeScore: 0.25,
  perAssetLimit: 3,
};

/**
 * v2 (IX2-U2): v1's weighted RRF over the entries that count. Text lists count a shot only where the query is closer
 * to its text than to 99 % of the text it isn't about (EmbeddingGemma 2, measured on the ranking study's "before"
 * bench library: transcript 0.71 (description takes the same: no stored library has descriptions yet), on-screen
 * text 0.74); frames count whole, since every shot has them; a keyword hit counts when it holds at least half of
 * the query's terms; a transcript segment counts for every shot it overlaps. Find similar is v1's. Numbers: the
 * library SPEC, P2-L10.
 */
export const SEARCH_FUSION_V2: SearchFusion = {
  ...SEARCH_FUSION_V1,
  version: 'search-fusion-v2',
  transcriptCredit: 'overlap',
  floors: { space: 'eg2_q4_daa72c5', similarity: { transcript: 0.71, description: 0.71, ocr: 0.74 } },
  keywordCoverage: 0.5,
};

/** Search's lists fused by the version's method. */
export function fuse(
  lists: MatchLists,
  fusion: SearchFusion,
  possible: readonly MatchList[] = MATCH_LISTS,
): FusedShot[] {
  return fusion.method.fuse(lists, possible);
}
