// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Weighted reciprocal-rank fusion (`search-fusion-v1`, and find similar in every version): each list adds
 * `w / (k + rank)` to a shot's score, whatever the match's similarity. A shot in a list at any rank gains, so in a
 * small library, where the kNN returns every vector, any shot with on-screen text gains an on-screen-text term:
 * search-fusion-v2 doesn't rank this way (fusion SPEC, P2-L10).
 */
import { byScore, collectTerms, type FusionMethod, type MatchList } from './lists';

export interface ReciprocalRankOptions {
  /** RRF's k. */
  readonly k: number;
  readonly weights: Readonly<Record<MatchList, number>>;
}

export function reciprocalRankFusion(options: ReciprocalRankOptions): FusionMethod {
  const { k, weights } = options;
  return {
    id: `rrf-k${k}`,
    fuse(lists, possible) {
      const max = possible.reduce((sum, list) => sum + weights[list] / (k + 1), 0);
      const shots = collectTerms(lists, (list, _match, index) => weights[list] / (k + index + 1));
      return [...shots]
        .map(([shotId, { terms, matchedBy }]) => ({
          shotId,
          score: max > 0 ? Math.min(1, terms.reduce((sum, term) => sum + term, 0) / max) : 0,
          matchedBy,
        }))
        .sort(byScore);
    },
  };
}
