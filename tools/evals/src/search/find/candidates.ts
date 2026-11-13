// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fusion candidates the find eval measures. Each is a whole `SearchFusion`, so it runs through the app's own
 * search. `v2` is what the library shipped before LIB1 (SEARCH_FUSION_V2); the others change one thing each, so a
 * gain can be put down to it: the description list's floor (v2 borrowed the transcript's 0.71, as no library had
 * descriptions then), the weights of the lists LIB1 made stronger (descriptions and keywords, which now carry the
 * actions), and RRF's k.
 */
import { reciprocalRankFusion, SEARCH_FUSION_V2, type SearchFusion } from '@taalcut/library';
import type { FindCandidate } from './run';

const V2_WEIGHTS: Readonly<Record<'frame' | 'description' | 'transcript' | 'ocr' | 'keyword', number>> = {
  frame: 1.0,
  description: 0.9,
  transcript: 0.7,
  ocr: 0.6,
  keyword: 0.8,
};

/** v2 with `change` applied: other weights, k, or the description floor. */
function variant(
  id: string,
  about: string,
  change: { weights?: Partial<typeof V2_WEIGHTS>; k?: number; descriptionFloor?: number },
): FindCandidate {
  const method = reciprocalRankFusion({ k: change.k ?? 60, weights: { ...V2_WEIGHTS, ...change.weights } });
  const floors = SEARCH_FUSION_V2.floors!;
  const fusion: SearchFusion = {
    ...SEARCH_FUSION_V2,
    version: `find-${id}`,
    method,
    floors:
      change.descriptionFloor === undefined
        ? floors
        : { ...floors, similarity: { ...floors.similarity, description: change.descriptionFloor } },
  };
  return { id, about, fusion };
}

export const FIND_CANDIDATES: readonly FindCandidate[] = [
  {
    id: 'v2',
    about:
      'search-fusion-v2 (IX2-U2): weighted RRF over the entries that count; text floors 0.71 (transcript, description) and 0.74 (on-screen text); a keyword hit holds half the query’s terms',
    fusion: SEARCH_FUSION_V2,
  },
  variant('desc-floor-65', 'v2, the description floor at 0.65', { descriptionFloor: 0.65 }),
  variant('desc-floor-68', 'v2, the description floor at 0.68', { descriptionFloor: 0.68 }),
  variant('desc-floor-74', 'v2, the description floor at 0.74', { descriptionFloor: 0.74 }),
  variant('desc-floor-77', 'v2, the description floor at 0.77', { descriptionFloor: 0.77 }),
  variant('desc-1.0', 'v2, descriptions weighted 1.0 (from 0.9)', { weights: { description: 1.0 } }),
  variant('desc-1.2', 'v2, descriptions weighted 1.2', { weights: { description: 1.2 } }),
  variant('kw-1.0', 'v2, keywords weighted 1.0 (from 0.8)', { weights: { keyword: 1.0 } }),
  variant('kw-0.6', 'v2, keywords weighted 0.6', { weights: { keyword: 0.6 } }),
  variant('frame-0.8', 'v2, frames weighted 0.8 (from 1.0)', { weights: { frame: 0.8 } }),
  variant('k-30', 'v2, RRF k = 30 (from 60)', { k: 30 }),
  variant('k-90', 'v2, RRF k = 90', { k: 90 }),
];
