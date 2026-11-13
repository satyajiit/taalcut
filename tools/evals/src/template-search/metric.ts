// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template search scores (LRN1-TPL): hit@5, reciprocal rank and binary nDCG@5 per query, averaged per query kind and
 * overall. The plan asks for hit@5 to be reported; there is no bar yet, so the suite claims no gate.
 */
import {
  TEMPLATE_QUERY_KINDS,
  type TemplateQuery,
  type TemplateQueryKind,
  type TemplateSearchPrediction,
} from './schema';

const TOP = 5;

export interface TemplateQueryScore {
  readonly queryId: string;
  readonly library: string;
  readonly kind: TemplateQueryKind;
  readonly hitAt5: number;
  readonly reciprocalRank: number;
  readonly ndcgAt5: number;
  readonly degraded: boolean;
}

export interface TemplateSearchRow {
  readonly kind: TemplateQueryKind | 'overall';
  readonly queries: number;
  readonly hitAt5: number;
  readonly meanReciprocalRank: number;
  readonly ndcgAt5: number;
}

export interface TemplateSearchScores {
  readonly queries: readonly TemplateQueryScore[];
  readonly rows: readonly TemplateSearchRow[];
  readonly missing: readonly string[];
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Binary nDCG@5; the ideal list is min(5, relevant) right templates. */
export function ndcgAt5(relevant: ReadonlySet<string>, results: readonly string[]): number {
  const ideal = Math.min(TOP, relevant.size);
  if (ideal === 0) return 0;
  let dcg = 0;
  results.slice(0, TOP).forEach((result, index) => {
    if (relevant.has(result)) dcg += 1 / Math.log2(index + 2);
  });
  let idcg = 0;
  for (let index = 0; index < ideal; index += 1) idcg += 1 / Math.log2(index + 2);
  return dcg / idcg;
}

export function scoreTemplateQuery(
  query: TemplateQuery,
  prediction: TemplateSearchPrediction | undefined,
): TemplateQueryScore {
  const relevant = new Set(query.relevant);
  const results = prediction?.results ?? [];
  const first = results.findIndex((result) => relevant.has(result));
  return {
    queryId: query.queryId,
    library: query.library,
    kind: query.kind,
    hitAt5: first >= 0 && first < TOP ? 1 : 0,
    reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
    ndcgAt5: ndcgAt5(relevant, results),
    degraded: prediction?.degraded !== null && prediction?.degraded !== undefined,
  };
}

function row(kind: TemplateSearchRow['kind'], scores: readonly TemplateQueryScore[]): TemplateSearchRow {
  return {
    kind,
    queries: scores.length,
    hitAt5: mean(scores.map((score) => score.hitAt5)),
    meanReciprocalRank: mean(scores.map((score) => score.reciprocalRank)),
    ndcgAt5: mean(scores.map((score) => score.ndcgAt5)),
  };
}

export function scoreTemplateSearch(
  queries: readonly TemplateQuery[],
  predictions: ReadonlyMap<string, TemplateSearchPrediction>,
): TemplateSearchScores {
  const missing: string[] = [];
  const scores = queries.map((query) => {
    const key = `${query.library}/${query.queryId}`;
    const prediction = predictions.get(key);
    if (!prediction) missing.push(key);
    return scoreTemplateQuery(query, prediction);
  });
  return {
    queries: scores,
    rows: [
      row('overall', scores),
      ...TEMPLATE_QUERY_KINDS.map((kind) =>
        row(
          kind,
          scores.filter((score) => score.kind === kind),
        ),
      ),
    ],
    missing,
  };
}
