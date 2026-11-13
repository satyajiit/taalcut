// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Memory items and an in-memory ranker for the agent's LRN1-MEM tests. */
import { newId, ok, type MemoryItemView, type MemoryScope, type ModelModuleId } from '@taalcut/core';
import type { MemoryRankerPort, MemoryRecallDeps, RankedMemoryItem } from '../../src/memory';

let clock = Date.UTC(2026, 9, 26);

export function memoryView(text: string, options: Partial<MemoryItemView> = {}): MemoryItemView {
  clock += 60_000;
  return {
    id: newId<'MemoryItem'>(),
    scope: { kind: 'user' },
    scopeName: null,
    text,
    source: 'user',
    data: null,
    conversationId: null,
    revision: 1,
    createdAt: clock,
    updatedAt: clock,
    ...options,
  };
}

const sameScope = (a: MemoryScope, b: MemoryScope) => JSON.stringify(a) === JSON.stringify(b);

export interface FakeRanker extends MemoryRankerPort {
  /** Every request, in order. */
  readonly asked: Parameters<MemoryRankerPort['rank']>[0][];
  /** The items it ranks; tests change them between runs. */
  items: MemoryItemView[];
}

/** Ranks the items in the scopes asked for, in the order given (the library's ranking is its own test). */
export function fakeRanker(items: MemoryItemView[]): FakeRanker {
  const ranker: FakeRanker = {
    asked: [],
    items,
    async rank(request) {
      ranker.asked.push(request);
      const ranked: RankedMemoryItem[] = ranker.items
        .filter((item) => request.scopes.some((scope) => sameScope(scope, item.scope)))
        .slice(0, request.k)
        .map((item) => ({ item, score: 1, matchedBy: ['words'] }));
      return ok(ranked);
    },
  };
  return ranker;
}

/** Recall deps: a ranker, the cloud switch, and which modules may leave the Mac. */
export function recallDeps(
  ranker: MemoryRankerPort,
  options: { cloudPrompts?: boolean; cloud?: readonly ModelModuleId[] } = {},
): MemoryRecallDeps & { switchReads: number } {
  const deps = {
    switchReads: 0,
    ranker,
    cloudPrompts: async () => {
      deps.switchReads++;
      return ok(options.cloudPrompts ?? true);
    },
    leavesDevice: (module: ModelModuleId) => (options.cloud ?? []).includes(module),
  };
  return deps;
}
