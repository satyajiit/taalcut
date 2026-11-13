// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Hybrid library search (P2-L10): FTS5 and vectors fused by reciprocal rank, find similar, and the eval hook. */
export { EmbedderUnavailable } from './errors';
export {
  evaluateSearch,
  type EvalQuery,
  type EvalQueryResult,
  type EvalReport,
  type LanguageScore,
} from './eval';
export { ftsQuery, keywordList, keywordMatches, parseSnippet, snippets, type Snippet } from './fts';
export {
  byScore,
  collectTerms,
  MATCH_KIND_OF,
  MATCH_LISTS,
  onePerShot,
  type FusedShot,
  type FusionMethod,
  type ListMatch,
  type MatchList,
  type MatchLists,
  type ShotTerms,
} from './fusion/lists';
export { reciprocalRankFusion, type ReciprocalRankOptions } from './fusion/reciprocal-rank';
export { countedLists } from './fusion/floors';
export {
  fuse,
  RRF_V1,
  SEARCH_FUSION_V1,
  SEARCH_FUSION_V2,
  type ListFloors,
  type SearchFusion,
  type TranscriptCredit,
  type VectorList,
} from './fusion/versions';
export { createLibrarySearch, type LibrarySearch, type LibrarySearchDeps } from './library-search';
export { meanVector } from './similar';
export { shotOfItem, similarityOf, vectorLists } from './vector-lists';
