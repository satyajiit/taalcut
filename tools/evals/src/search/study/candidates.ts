// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fusion candidates the study measures (IX2-U2). Each is a full `SearchFusion`, so it runs through the app's
 * own search. Floors are EmbeddingGemma 2 cosine similarities read off the study's "before" bench library: the 95th
 * and 99th percentiles of a query's similarity to the transcript segments and on-screen lines it isn't about
 * (tools/evals SPEC, "IX2 search ranking study"). `v2` is the library's SEARCH_FUSION_V2.
 */
import {
  RRF_V1,
  SEARCH_FUSION_V1,
  SEARCH_FUSION_V2,
  type SearchFusion,
  type TranscriptCredit,
} from '@taalcut/library';
import { EMBEDDING_SPACE } from '@taalcut/vision';
import { maxFusion, scoreFusion, withinOfBest } from './methods';
import type { StudyCandidate } from './run';

const V1_WEIGHTS = { frame: 1.0, description: 0.9, transcript: 0.7, ocr: 0.6, keyword: 0.8 } as const;

/** Text lists (on-screen text, transcript, description) floored; frames and keywords count whole. */
const textFloors = (transcript: number, ocr: number) => ({ transcript, description: transcript, ocr });

function variant(
  version: string,
  credit: TranscriptCredit,
  change: Partial<SearchFusion> = {},
): SearchFusion {
  return { ...SEARCH_FUSION_V1, version, transcriptCredit: credit, ...change };
}

const floors = (transcript: number, ocr: number) => ({
  floors: { space: EMBEDDING_SPACE.indexName, similarity: textFloors(transcript, ocr) },
});

export const STUDY_CANDIDATES: readonly StudyCandidate[] = [
  {
    id: 'v1',
    about:
      'weighted RRF (k = 60) over every entry; a transcript segment counts for the shot holding its start',
    fusion: SEARCH_FUSION_V1,
  },
  {
    id: 'v1-overlap',
    about: 'v1, a transcript segment counting for every shot it overlaps',
    fusion: variant('study-v1-overlap', 'overlap'),
  },
  {
    id: 'max',
    about: 'each shot’s best single reciprocal-rank term (v1 weights), over the lists it is in',
    fusion: variant('study-max', 'start', { method: maxFusion({ k: 60, weights: V1_WEIGHTS }) }),
  },
  {
    id: 'within-0.05',
    about: 'v1 over text-list entries within 0.05 of their list’s best',
    fusion: variant('study-within', 'start', {
      method: withinOfBest(RRF_V1, { transcript: 0.05, ocr: 0.05, description: 0.05 }),
    }),
  },
  {
    id: 'floor-p95',
    about:
      'v1 over text-list entries above unrelated pairs’ 95th percentile (transcript, description 0.68; on-screen 0.72)',
    fusion: variant('study-floor-p95', 'start', floors(0.68, 0.72)),
  },
  {
    id: 'floor-p95-overlap',
    about: 'floor-p95, transcript credit by overlap',
    fusion: variant('study-floor-p95-overlap', 'overlap', floors(0.68, 0.72)),
  },
  {
    id: 'floor-p99',
    about:
      'v1 over text-list entries above unrelated pairs’ 99th percentile (transcript, description 0.71; on-screen 0.74)',
    fusion: variant('study-floor-p99', 'start', floors(0.71, 0.74)),
  },
  {
    id: 'floor-p99-overlap',
    about: 'floor-p99, transcript credit by overlap',
    fusion: variant('study-floor-p99-overlap', 'overlap', floors(0.71, 0.74)),
  },
  {
    id: 'v2-start',
    about: 'v2 with a transcript segment counting for the shot holding its start',
    fusion: { ...SEARCH_FUSION_V2, version: 'study-v2-start', transcriptCredit: 'start' },
  },
  {
    id: 'v2',
    about:
      'search-fusion-v2: floor-p99-overlap, and a keyword hit counts when it holds at least half of the query’s terms',
    fusion: SEARCH_FUSION_V2,
  },
  {
    id: 'score-p95',
    about:
      'Σ w · (similarity − floor) / (1 − floor), v1 weights; floors: frames 0.58 (unrelated pairs’ median), text lists their 95th percentile, keywords 0',
    fusion: variant('study-score-p95', 'start', {
      method: scoreFusion({
        weights: V1_WEIGHTS,
        floors: { frame: 0.58, ...textFloors(0.68, 0.72) },
        ceilings: {},
      }),
    }),
  },
  {
    id: 'score-p95-overlap',
    about: 'score-p95, transcript credit by overlap',
    fusion: variant('study-score-p95-overlap', 'overlap', {
      method: scoreFusion({
        weights: V1_WEIGHTS,
        floors: { frame: 0.58, ...textFloors(0.68, 0.72) },
        ceilings: {},
      }),
    }),
  },
];
