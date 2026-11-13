// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hybrid library search (P2-L10), served as `library.search` and
 * `library.findSimilar` in the agent process and wrapped by the agent tools.
 *
 * Search: the query is embedded once (an LRU keeps 200 recent ones) through
 * core's Embedder, which runs EmbeddingGemma 2 locally in the jobs process;
 * one exact kNN over the active space is split into frame, description,
 * transcript and on-screen-text lists, FTS5 gives a keyword list, the
 * entries that count are kept (search-fusion-v2: similarity floors on the
 * text lists, keyword coverage; fusion/floors.ts), and weighted
 * reciprocal-rank fusion orders the shots. Filters apply in SQL
 * after fusion; when they leave too few hits the kNN widens once. Without
 * the embedder (model not installed yet, or it fails) search answers from
 * keywords alone and says so (`degraded: 'keyword-only'`). Nothing leaves the
 * process except the call to the local embedder.
 */
import {
  err,
  ok,
  type AsyncResult,
  type Embedder,
  type LibraryFilters,
  type Result,
  type SearchResult,
  type ShotId,
  type VectorIndex,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { LibrarySearchPort } from '../profile';
import { EmbedderUnavailable } from './errors';
import { filenameShotMatches } from './filename-matches';
import { keywordList, snippets } from './fts';
import { countedLists } from './fusion/floors';
import { byScore, MATCH_LISTS, type FusedShot, type MatchLists } from './fusion/lists';
import { SEARCH_FUSION_V2, type SearchFusion } from './fusion/versions';
import { buildHits, rankShots, type Ranked } from './hits';
import { findSimilarShots } from './similar';
import { vectorLists } from './vector-lists';

export interface LibrarySearchDeps {
  readonly db: LibraryDatabase;
  /** The active embedding space's index (EmbeddingIndexToken); null before one exists. */
  readonly vectors: VectorIndex | null;
  /** Core's Embedder; null while the model isn't installed. */
  readonly embedder: Embedder | null;
  /** Default SEARCH_FUSION_V2. */
  readonly fusion?: SearchFusion;
  /** For `tookMs`. Default performance.now. */
  readonly now?: () => number;
}

export interface LibrarySearch extends LibrarySearchPort {
  readonly fusion: SearchFusion;
}

const QUERY_CACHE = 200;
const MAX_LIMIT = 100;

/** A small LRU of query embeddings: the same question asked again skips the model. */
function queryCache() {
  const cache = new Map<string, Float32Array>();
  return {
    get(key: string) {
      const hit = cache.get(key);
      if (hit) {
        cache.delete(key);
        cache.set(key, hit);
      }
      return hit;
    },
    set(key: string, vector: Float32Array) {
      cache.set(key, vector);
      if (cache.size > QUERY_CACHE) cache.delete(cache.keys().next().value!);
    },
  };
}

/** Places exact filename / filename-stem matches above vector noise in query order. */
function boostExactMatches(fused: readonly FusedShot[], exact: readonly ShotId[]): readonly FusedShot[] {
  if (exact.length === 0) return fused;
  const exactIndex = new Map(exact.map((shotId, i) => [shotId, i]));
  const maxOther = fused.reduce(
    (max, item) => (exactIndex.has(item.shotId) ? max : Math.max(max, item.score)),
    0,
  );
  const floor = Math.min(0.9, Math.max(0.75, maxOther + 0.05));
  const span = 1 - floor;
  const present = new Set<ShotId>();
  const boosted = fused.map((item) => {
    const idx = exactIndex.get(item.shotId);
    if (idx === undefined) return item;
    present.add(item.shotId);
    const score = floor + span * ((exact.length - idx) / exact.length);
    return {
      shotId: item.shotId,
      score: Math.min(1, Math.max(item.score, score)),
      matchedBy: item.matchedBy.includes('keyword')
        ? item.matchedBy
        : [...item.matchedBy, 'keyword' as const],
    };
  });
  for (const [idx, shotId] of exact.entries()) {
    if (!present.has(shotId)) {
      boosted.push({
        shotId,
        score: floor + span * ((exact.length - idx) / exact.length),
        matchedBy: ['keyword'],
      });
    }
  }
  return boosted.sort(byScore);
}

export function createLibrarySearch(deps: LibrarySearchDeps): LibrarySearch {
  const { db } = deps;
  const fusion = deps.fusion ?? SEARCH_FUSION_V2;
  const now = deps.now ?? (() => performance.now());
  const cache = queryCache();

  /** The query's vector, or null when there is no embedder or it fails (keyword-only). */
  async function embed(query: string): Promise<Float32Array | null> {
    if (!deps.embedder || !deps.vectors) return null;
    const cached = cache.get(query);
    if (cached) return cached;
    const embedded = await deps.embedder.embedTexts([query], { purpose: 'query' });
    if (!embedded.ok || !embedded.value[0]) return null;
    cache.set(query, embedded.value[0]);
    return embedded.value[0];
  }

  async function search(
    text: string,
    filters: LibraryFilters | undefined,
    limit: number,
  ): AsyncResult<SearchResult> {
    const started = now();
    const query = text.normalize('NFC').trim();
    const max = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
    const exact = filenameShotMatches(db, query);
    const keyword = keywordList(db, query, Math.max(fusion.keywordLimit, exact.length));
    const vector = await embed(query);

    /** One pass: the kNN at `k`, fused with the keyword list, filtered and capped. */
    const pass = (k: number): Result<{ ranked: Ranked; widen: boolean }> => {
      let lists: MatchLists = { keyword };
      let widen = false;
      if (vector && deps.vectors) {
        const matches = deps.vectors.search(vector, { k });
        if (!matches.ok) return matches;
        widen = matches.value.length >= k && k < fusion.maxKnn;
        const options = { metric: deps.vectors.metric, transcriptCredit: fusion.transcriptCredit };
        lists = { ...vectorLists(db, matches.value, options), keyword };
      }
      // Floors and keyword coverage weigh lists against each other; with keywords alone, every hit counts.
      const counted = vector ? countedLists(lists, fusion, deps.vectors?.name) : lists;
      const fused = boostExactMatches(fusion.method.fuse(counted, vector ? MATCH_LISTS : ['keyword']), exact);
      return ok({ ranked: rankShots(db, fused, fusion, { filters, limit: max }), widen });
    };

    let result = pass(Math.min(fusion.knn, fusion.maxKnn));
    if (!result.ok) return result;
    // Filters left fewer hits than asked: widen the kNN once.
    if (result.value.ranked.short && result.value.widen) {
      result = pass(Math.min(fusion.knn * 4, fusion.maxKnn));
      if (!result.ok) return result;
    }
    return ok(finish(query, result.value.ranked.picked, started, !vector));
  }

  function finish(
    query: string,
    picked: Parameters<typeof buildHits>[1],
    started: number,
    degraded: boolean,
  ): SearchResult {
    const keywordShots = picked.filter((p) => p.matchedBy.includes('keyword')).map((p) => p.shotId);
    const hits = buildHits(db, picked, snippets(db, query, keywordShots));
    return {
      hits,
      tookMs: Math.max(0, Math.round(now() - started)),
      ...(degraded ? { degraded: 'keyword-only' as const } : {}),
    };
  }

  return {
    fusion,
    search,
    async findSimilar(shotId, filters, limit, excludeSameAsset) {
      const started = now();
      const vectors = deps.vectors;
      if (!vectors) return err(EmbedderUnavailable(undefined, { detail: 'no vector index' }));
      const found = findSimilarShots(db, vectors, fusion, {
        shotId,
        filters,
        limit: Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit))),
        excludeSameAsset,
      });
      if (!found.ok) return found;
      return ok({ hits: buildHits(db, found.value), tookMs: Math.max(0, Math.round(now() - started)) });
    },
  };
}
