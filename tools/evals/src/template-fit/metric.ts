// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template fit scores (LRN1-TPL): for each footage set, where the template it was shot for lands in the fit's
 * ranking. The plan's bar: the right template in the top 3 for at least 80% of sets.
 */
import type { FitCase, FitPrediction, FitRank } from './schema';

export const FIT_TOP3_BAR = 0.8;

export interface FitCaseScore {
  readonly caseId: string;
  readonly library: string;
  /** 1-based; null when the template isn't ranked (or there is no prediction). */
  readonly rank: number | null;
  readonly top1: boolean;
  readonly top3: boolean;
}

export interface FitScores {
  readonly cases: readonly FitCaseScore[];
  readonly top1: number;
  readonly top3: number;
  readonly meanReciprocalRank: number;
  readonly missing: readonly string[];
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export function scoreFitCases(
  cases: readonly FitCase[],
  predictions: ReadonlyMap<string, FitPrediction>,
): FitScores {
  const missing: string[] = [];
  const rows = cases.map((item) => {
    const key = `${item.library}/${item.caseId}`;
    const prediction = predictions.get(key);
    if (!prediction) missing.push(key);
    const at = prediction ? prediction.ranking.findIndex((row) => row.template === item.best) : -1;
    const rank = at < 0 ? null : at + 1;
    return {
      caseId: item.caseId,
      library: item.library,
      rank,
      top1: rank === 1,
      top3: rank !== null && rank <= 3,
    };
  });
  return {
    cases: rows,
    top1: mean(rows.map((row) => (row.top1 ? 1 : 0))),
    top3: mean(rows.map((row) => (row.top3 ? 1 : 0))),
    meanReciprocalRank: mean(rows.map((row) => (row.rank === null ? 0 : 1 / row.rank))),
    missing,
  };
}

/** Every set predicted, and the right template in the top 3 for at least 80% of them. */
export function fitGatePasses(scores: FitScores): boolean {
  return scores.cases.length > 0 && scores.missing.length === 0 && scores.top3 >= FIT_TOP3_BAR;
}

/** Higher first; null (nothing filled) last. */
const desc = (a: number | null, b: number | null) => (b ?? -1) - (a ?? -1);

/**
 * The orders the fitter's (fit score: the mean over every slot, a short slot scoring 0) is weighed against (timeline
 * SPEC, "LRN1-TPL", step 5): coverage first, then the mean casting score; and the mean casting score alone.
 * Predictions carry no hook, so a tie keeps the fitter's order.
 */
export const ALTERNATIVE_ORDERS: Readonly<Record<string, (a: FitRank, b: FitRank) => number>> = {
  'complete first': (a, b) => b.coverage - a.coverage || desc(a.meanScore, b.meanScore),
  'match alone': (a, b) => desc(a.meanScore, b.meanScore),
};

/** Each prediction's ranking re-sorted by `order` (a stable sort). */
export function reranked(
  predictions: ReadonlyMap<string, FitPrediction>,
  order: (a: FitRank, b: FitRank) => number,
): Map<string, FitPrediction> {
  return new Map(
    [...predictions].map(([id, prediction]) => [
      id,
      { ...prediction, ranking: [...prediction.ranking].sort(order) },
    ]),
  );
}
