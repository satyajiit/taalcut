// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The find eval's scores. A query's answer is a set of whole clips; search returns shots, a clip at most a few
 * times. Per query:
 * - recall@10: the share of its clips that show up among the first 10 hits (of at most 10 clips);
 * - reciprocal rank: 1 / the rank of the first hit from one of its clips, 0 when none in the hits asked for;
 * - hit@1 and hit@5: whether one of its clips is first, or in the first five;
 * - R-precision: of the first R distinct clips the hits name, R being how many clips answer, the share that do.
 *   Recall@10 is lenient in a library of fifty clips; R-precision asks for its clips before any other.
 * Groups (all, a kind, a language) average their queries.
 */

/** Hits each query asks for: deep enough for reciprocal rank past the top 10. */
export const FIND_LIMIT = 20;
const RECALL_AT = 10;

export interface QueryScore {
  readonly recallAt10: number;
  readonly reciprocalRank: number;
  readonly hitAt1: number;
  readonly hitAt5: number;
  readonly rPrecision: number;
  /** 1-based rank of the first relevant hit, or null. */
  readonly rank: number | null;
}

/** Scores the hits (each hit's clip id, best first) against the clips that answer. */
export function scoreQuery(relevant: readonly string[], hits: readonly string[]): QueryScore {
  const wanted = new Set(relevant);
  const index = hits.findIndex((clip) => wanted.has(clip));
  const rank = index < 0 ? null : index + 1;
  const found = new Set(hits.slice(0, RECALL_AT).filter((clip) => wanted.has(clip)));
  const firstClips = [...new Set(hits)].slice(0, wanted.size);
  return {
    recallAt10: wanted.size === 0 ? 0 : found.size / Math.min(RECALL_AT, wanted.size),
    reciprocalRank: rank === null ? 0 : 1 / rank,
    hitAt1: rank === 1 ? 1 : 0,
    hitAt5: rank !== null && rank <= 5 ? 1 : 0,
    rPrecision: wanted.size === 0 ? 0 : firstClips.filter((clip) => wanted.has(clip)).length / wanted.size,
    rank,
  };
}

export interface GroupScore {
  readonly queries: number;
  readonly recallAt10: number;
  readonly mrr: number;
  readonly hitAt1: number;
  readonly hitAt5: number;
  readonly rPrecision: number;
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export function groupScore(scores: readonly QueryScore[]): GroupScore {
  return {
    queries: scores.length,
    recallAt10: mean(scores.map((s) => s.recallAt10)),
    mrr: mean(scores.map((s) => s.reciprocalRank)),
    hitAt1: mean(scores.map((s) => s.hitAt1)),
    hitAt5: mean(scores.map((s) => s.hitAt5)),
    rPrecision: mean(scores.map((s) => s.rPrecision)),
  };
}
