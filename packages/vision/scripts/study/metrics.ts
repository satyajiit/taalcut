// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Retrieval scores for the token-budget study (IX-E2): each query ranks the
 * frames of one framing (or all of them), and a frame is relevant when it
 * shows the query's subject. hit@1, hit@5 and reciprocal rank, as the search
 * eval scores them, averaged per language.
 */
import { cosineDistance } from '../../src/embed/space';

export interface Ranked {
  readonly subject: string;
  readonly vector: Float32Array;
}

export interface QueryVector {
  readonly subject: string;
  readonly language: string;
  readonly vector: Float32Array;
}

export interface RetrievalScore {
  readonly queries: number;
  readonly hit1: number;
  readonly hit5: number;
  readonly mrr: number;
}

/** 1-based rank of the first frame of the query's subject. */
function firstRelevantRank(query: QueryVector, frames: readonly Ranked[]): number {
  const order = frames
    .map((frame) => ({ subject: frame.subject, distance: cosineDistance(query.vector, frame.vector) }))
    .sort((a, b) => a.distance - b.distance);
  return order.findIndex((entry) => entry.subject === query.subject) + 1;
}

export function score(queries: readonly QueryVector[], frames: readonly Ranked[]): RetrievalScore {
  const ranks = queries.map((query) => firstRelevantRank(query, frames));
  const share = (test: (rank: number) => boolean) =>
    ranks.length === 0 ? 0 : ranks.filter(test).length / ranks.length;
  return {
    queries: ranks.length,
    hit1: share((rank) => rank === 1),
    hit5: share((rank) => rank >= 1 && rank <= 5),
    mrr:
      ranks.length === 0 ? 0 : ranks.reduce((sum, rank) => sum + (rank > 0 ? 1 / rank : 0), 0) / ranks.length,
  };
}

/** Scores overall and per language. */
export function scoreByLanguage(
  queries: readonly QueryVector[],
  frames: readonly Ranked[],
): Record<string, RetrievalScore> {
  const out: Record<string, RetrievalScore> = { all: score(queries, frames) };
  for (const language of [...new Set(queries.map((q) => q.language))]) {
    out[language] = score(
      queries.filter((q) => q.language === language),
      frames,
    );
  }
  return out;
}

/** Mean and minimum cosine similarity between two vector lists, pairwise. */
export function agreement(
  a: readonly Float32Array[],
  b: readonly Float32Array[],
): { mean: number; min: number } {
  const sims = a.map((vector, i) => 1 - cosineDistance(vector, b[i] ?? new Float32Array(vector.length)));
  return {
    mean: sims.reduce((sum, x) => sum + x, 0) / Math.max(1, sims.length),
    min: sims.reduce((low, x) => Math.min(low, x), Number.POSITIVE_INFINITY),
  };
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
