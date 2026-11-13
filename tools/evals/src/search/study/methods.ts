// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fusion methods the study measures beside the library's own (IX2-U2's candidates). Each is a `FusionMethod`, so
 * it runs inside the app's search unchanged:
 * - `maxFusion`: a shot's best single term over the lists it is in (absence and extra presence are both neutral);
 * - `withinOfBest`: drops list entries further than a margin below their list's best, then fuses the rest (the
 *   relative counterpart of the library's absolute floors);
 * - `scoreFusion`: the weighted sum of each list's similarity mapped onto 0..1 between a floor and a ceiling.
 */
import {
  byScore,
  collectTerms,
  MATCH_LISTS,
  type FusionMethod,
  type MatchList,
  type MatchLists,
} from '@taalcut/library';

type Weights = Readonly<Record<MatchList, number>>;
type PerList = Partial<Readonly<Record<MatchList, number>>>;

/** Each shot's best reciprocal-rank term, over the best any list could give. */
export function maxFusion(options: { readonly k: number; readonly weights: Weights }): FusionMethod {
  const { k, weights } = options;
  return {
    id: `max-rrf-k${k}`,
    fuse(lists, possible) {
      const max = Math.max(0, ...possible.map((list) => weights[list] / (k + 1)));
      return [...collectTerms(lists, (list, _match, index) => weights[list] / (k + index + 1))]
        .map(([shotId, { terms, matchedBy }]) => ({
          shotId,
          score: max > 0 ? Math.min(1, Math.max(...terms) / max) : 0,
          matchedBy,
        }))
        .sort(byScore);
    },
  };
}

/** `method` over the lists cut to the entries within `margins` of their list's best. */
export function withinOfBest(method: FusionMethod, margins: PerList): FusionMethod {
  return {
    id: `within-${method.id}`,
    fuse(lists, possible) {
      const out: MatchLists = {};
      for (const list of MATCH_LISTS) {
        const ranked = lists[list];
        if (!ranked) continue;
        const margin = margins[list];
        const best = ranked[0]?.similarity ?? 0;
        out[list] = margin === undefined ? ranked : ranked.filter((m) => m.similarity >= best - margin);
      }
      return method.fuse(out, possible);
    },
  };
}

export interface ScoreFusionOptions {
  readonly weights: Weights;
  /** Similarity that counts as no evidence (0) per list. Keywords: the share of query terms held, default 0. */
  readonly floors: PerList;
  /** Similarity that counts as full evidence (1) per list. Default 1. */
  readonly ceilings: PerList;
}

/** Σ wᵢ · clamp((simᵢ − floorᵢ) / (ceilᵢ − floorᵢ)), over the sum of the possible lists' weights. */
export function scoreFusion(options: ScoreFusionOptions): FusionMethod {
  const { weights, floors, ceilings } = options;
  const evidence = (list: MatchList, similarity: number) => {
    const floor = floors[list] ?? 0;
    const ceiling = ceilings[list] ?? 1;
    return Math.min(1, Math.max(0, (similarity - floor) / Math.max(1e-6, ceiling - floor)));
  };
  return {
    id: 'score-sum',
    fuse(lists, possible) {
      const max = possible.reduce((sum, list) => sum + weights[list], 0);
      return [...collectTerms(lists, (list, match) => weights[list] * evidence(list, match.similarity))]
        .map(([shotId, { terms, matchedBy }]) => ({
          shotId,
          score: max > 0 ? terms.reduce((a, b) => a + b, 0) / max : 0,
          matchedBy: matchedBy.filter((_, i) => (terms[i] ?? 0) > 0),
        }))
        .filter((shot) => shot.score > 0)
        .sort(byScore);
    },
  };
}
