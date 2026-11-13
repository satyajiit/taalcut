// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type EvalShot } from '../adapters/types';
import { shotsMatch } from '../shot-match';
import { searchLanguageSchema, type SearchPrediction, type SearchQueryLabel } from './schema';

/** Gate criterion 11. */
export const SEARCH_HIT_BAR = 0.75;

const TOP = 5;

export interface QueryScore {
  queryId: string;
  language: SearchQueryLabel['language'];
  hitAt5: number;
  /** Relevant hits in the top 5, divided by min(5, result count). 0 when the list is empty. */
  precisionAt5: number;
  reciprocalRank: number;
  ndcgAt5: number;
}

export interface LanguageScore {
  language: SearchQueryLabel['language'] | 'overall';
  queries: number;
  hitAt5: number;
  precisionAt5: number;
  reciprocalRank: number;
  ndcgAt5: number;
}

function relevantHit(shot: EvalShot, relevant: readonly EvalShot[]): boolean {
  return relevant.some((label) => shotsMatch(label, shot));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Binary nDCG@5. Missing ranks are relevance 0. Ideal length is min(5, labelled shots). */
export function ndcgAt5(relevant: readonly EvalShot[], results: readonly EvalShot[]): number {
  const idealCount = Math.min(TOP, relevant.length);
  if (idealCount === 0) return 0;
  let dcg = 0;
  for (let index = 0; index < TOP; index += 1) {
    const shot = results[index];
    const gain = shot !== undefined && relevantHit(shot, relevant) ? 1 : 0;
    dcg += gain / Math.log2(index + 2);
  }
  let idcg = 0;
  for (let index = 0; index < idealCount; index += 1) idcg += 1 / Math.log2(index + 2);
  return dcg / idcg;
}

export function scoreQuery(query: SearchQueryLabel, prediction: SearchPrediction): QueryScore {
  const results = prediction.results;
  const top = results.slice(0, TOP);
  const hits = top.filter((shot) => relevantHit(shot, query.relevant)).length;
  const first = results.findIndex((shot) => relevantHit(shot, query.relevant));
  return {
    queryId: query.queryId,
    language: query.language,
    hitAt5: hits > 0 ? 1 : 0,
    precisionAt5: top.length === 0 ? 0 : hits / top.length,
    reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
    ndcgAt5: ndcgAt5(query.relevant, results),
  };
}

function languageRow(
  language: LanguageScore['language'],
  rows: readonly QueryScore[],
): LanguageScore {
  return {
    language,
    queries: rows.length,
    hitAt5: mean(rows.map((row) => row.hitAt5)),
    precisionAt5: mean(rows.map((row) => row.precisionAt5)),
    reciprocalRank: mean(rows.map((row) => row.reciprocalRank)),
    ndcgAt5: mean(rows.map((row) => row.ndcgAt5)),
  };
}

export function aggregateSearch(queries: readonly QueryScore[]): LanguageScore[] {
  const overall = languageRow('overall', queries);
  const perLanguage = searchLanguageSchema.options.map((language) =>
    languageRow(
      language,
      queries.filter((row) => row.language === language),
    ),
  );
  return [overall, ...perLanguage];
}

/**
 * Passes when hit@5 is at least 0.75 overall and in every language.
 * A language with no queries fails the "each language" reading.
 */
export function searchGatePasses(rows: readonly LanguageScore[]): boolean {
  return rows.every((row) => row.queries > 0 && row.hitAt5 >= SEARCH_HIT_BAR);
}
