// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The search side of the P2-Q1 eval (gate criterion 11: a relevant shot in
 * the top 5 for at least 75% of queries, in all four languages). tools/evals
 * calls this with the labelled queries once people have labelled the sample
 * libraries; until then tests run it on a synthetic set. It reports, never
 * decides: the gate is the runner's.
 */
import type { LibraryFilters } from '@taalcut/core';
import type { LibrarySearchPort } from '../profile';

export interface EvalQuery {
  /** Stable id from the label file, for the report. */
  readonly id?: string;
  readonly query: string;
  /** BCP 47, e.g. 'hi'. */
  readonly language: string;
  /** Shots a person marked relevant. */
  readonly relevant: readonly string[];
  /** Or whole assets, when the label is "this clip". */
  readonly relevantAssets?: readonly string[];
  readonly filters?: LibraryFilters;
}

export interface EvalQueryResult {
  readonly id?: string;
  readonly query: string;
  readonly language: string;
  readonly hit: boolean;
  /** 1-based rank of the first relevant hit within the top k, or null. */
  readonly firstRelevantRank: number | null;
  readonly topShotIds: readonly string[];
  readonly degraded: boolean;
  readonly tookMs: number;
}

export interface LanguageScore {
  readonly queries: number;
  readonly hits: number;
  readonly hitRate: number;
}

export interface EvalReport {
  readonly k: number;
  readonly queries: readonly EvalQueryResult[];
  /** Share of queries with a relevant shot in the top k, 0..1. */
  readonly hitRate: number;
  readonly byLanguage: Readonly<Record<string, LanguageScore>>;
  /** Queries that failed outright (errors), counted as misses above. */
  readonly errors: readonly { readonly query: string; readonly code: string }[];
}

/** Runs every query through `search` and scores the top `k` (default 5). Queries run one at a time. */
export async function evaluateSearch(
  search: Pick<LibrarySearchPort, 'search'>,
  queries: readonly EvalQuery[],
  options: { readonly k?: number } = {},
): Promise<EvalReport> {
  const k = options.k ?? 5;
  const results: EvalQueryResult[] = [];
  const errors: { query: string; code: string }[] = [];
  for (const q of queries) {
    const found = await search.search(q.query, q.filters, k);
    const hits = found.ok ? found.value.hits.slice(0, k) : [];
    if (!found.ok) errors.push({ query: q.query, code: found.error.code });
    const relevant = new Set(q.relevant);
    const relevantAssets = new Set(q.relevantAssets ?? []);
    const index = hits.findIndex((h) => relevant.has(h.shot.id) || relevantAssets.has(h.shot.assetId));
    results.push({
      ...(q.id ? { id: q.id } : {}),
      query: q.query,
      language: q.language,
      hit: index >= 0,
      firstRelevantRank: index >= 0 ? index + 1 : null,
      topShotIds: hits.map((h) => h.shot.id),
      degraded: found.ok && found.value.degraded !== undefined,
      tookMs: found.ok ? found.value.tookMs : 0,
    });
  }
  const byLanguage: Record<string, { queries: number; hits: number; hitRate: number }> = {};
  for (const r of results) {
    const entry = (byLanguage[r.language] ??= { queries: 0, hits: 0, hitRate: 0 });
    entry.queries += 1;
    if (r.hit) entry.hits += 1;
    entry.hitRate = entry.hits / entry.queries;
  }
  const hits = results.filter((r) => r.hit).length;
  return { k, queries: results, hitRate: results.length ? hits / results.length : 0, byLanguage, errors };
}
