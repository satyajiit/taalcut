// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which memory items matter for a run (LRN1-MEM): the agent asks for the top k in its scopes (the user, plus the
 * run's project and template) for its message. When the scopes hold k items or fewer, all of them come back,
 * newest first: nothing to choose. Otherwise three ranked lists are fused by reciprocal rank, as library search
 * fuses its lists: meaning (the memory index, nearest to the message's embedding), words (FTS5, bm25) and recency.
 * Meaning needs the embedding model; until the jobs process serves it, that list is absent and the other two rank.
 */
import {
  MEMORY_LIST_MAX,
  ok,
  type AsyncResult,
  type Embedder,
  type MemoryItemView,
  type MemoryScope,
  type MemoryStore,
  type VectorIndex,
} from '@taalcut/core';

/** RRF's k, as library search uses it. */
const RRF_K = 60;
const WEIGHTS = { meaning: 1, words: 1, recency: 0.5 } as const;

export type MemoryMatch = keyof typeof WEIGHTS;

export interface RankedMemory {
  readonly item: MemoryItemView;
  /** The fused value over the most it could be, 0..1; 1 when every candidate came back. */
  readonly score: number;
  readonly matchedBy: readonly MemoryMatch[];
}

export interface MemoryRankRequest {
  readonly scopes: readonly MemoryScope[];
  /** What the run is about (its message). Empty: recency alone. */
  readonly query: string;
  readonly k: number;
  readonly signal?: AbortSignal;
}

export interface MemoryRanker {
  rank(request: MemoryRankRequest): AsyncResult<RankedMemory[]>;
}

export interface MemoryRankerDeps {
  readonly store: Pick<MemoryStore, 'list'>;
  /** The memory index and the query embedder, or null while the embedding model isn't served. */
  readonly space: () => Promise<{ readonly index: VectorIndex; readonly embedder: Embedder } | null>;
}

/** Ids nearest the query, nearest first, among `among`. Empty when the space isn't there or can't embed now. */
async function meaningList(
  deps: MemoryRankerDeps,
  query: string,
  among: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<string[]> {
  if (query.trim() === '') return [];
  const space = await deps.space();
  if (!space || space.index.count() === 0) return [];
  const embedded = await space.embedder.embedTexts([query], { purpose: 'query', ...(signal ? { signal } : {}) });
  if (!embedded.ok || !embedded.value[0]) return [];
  const k = Math.min(4096, space.index.count());
  const found = space.index.search(embedded.value[0], { k });
  return found.ok ? found.value.map((match) => match.id).filter((id) => among.has(id)) : [];
}

export function createMemoryRanker(deps: MemoryRankerDeps): MemoryRanker {
  return {
    async rank({ scopes, query, k, signal }) {
      const limit = Math.max(1, Math.floor(k));
      const listed = await deps.store.list({ scopes, limit: MEMORY_LIST_MAX });
      if (!listed.ok) return listed;
      const candidates = listed.value;
      if (candidates.length <= limit)
        return ok(candidates.map((item) => ({ item, score: 1, matchedBy: ['recency' as const] })));

      const ids = new Set<string>(candidates.map((item) => item.id));
      const words =
        query.trim() === '' ? ok([]) : await deps.store.list({ scopes, query, limit: MEMORY_LIST_MAX });
      if (!words.ok) return words;
      const lists: Record<MemoryMatch, readonly string[]> = {
        meaning: await meaningList(deps, query, ids, signal),
        words: words.value.map((item) => item.id),
        recency: candidates.map((item) => item.id),
      };
      const scores = new Map<string, { score: number; matchedBy: MemoryMatch[] }>();
      for (const [list, ranked] of Object.entries(lists) as [MemoryMatch, readonly string[]][])
        ranked.forEach((id, index) => {
          const entry = scores.get(id) ?? { score: 0, matchedBy: [] };
          entry.score += WEIGHTS[list] / (RRF_K + index + 1);
          entry.matchedBy.push(list);
          scores.set(id, entry);
        });
      const max = (Object.keys(lists) as MemoryMatch[])
        .filter((list) => lists[list].length > 0)
        .reduce((sum, list) => sum + WEIGHTS[list] / (RRF_K + 1), 0);
      // Ties keep the newer item first: candidates are newest first and the sort is stable.
      const ranked = candidates
        .map((item) => ({ item, ...(scores.get(item.id) ?? { score: 0, matchedBy: [] }) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return ok(
        ranked.map(({ item, score, matchedBy }) => ({
          item,
          score: max > 0 ? Math.min(1, score / max) : 0,
          matchedBy,
        })),
      );
    },
  };
}
