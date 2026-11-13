// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Memory items as stored (LRN1-MEM): @taalcut/library implements the store (migration 30) and registers it as
 * MemoryStoreToken in the agent process; writes with a CommandContext are staged in the command's unit of work, so
 * they commit with its audit row or not at all. The text is embedded into the memory index (MemoryIndexToken) after
 * the write commits; the index is derived and rebuilt from the store.
 */
import type { MemoryId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';
import type {
  MemoryDataKind,
  MemoryItem,
  MemoryItemView,
  MemoryScope,
  MemoryScopeKind,
  MemorySource,
} from './memory-schema';

/** The most items one list returns. */
export const MEMORY_LIST_MAX = 1000;

export interface MemoryFilter {
  /** Items in any of these scopes. Absent: every scope; empty: none. */
  readonly scopes?: readonly MemoryScope[];
  /** Items whose scope is of these kinds (Settings' groups, its counts). Absent: every kind; empty: none. */
  readonly kinds?: readonly MemoryScopeKind[];
  /** Absent: every source. */
  readonly sources?: readonly MemorySource[];
  /** Items whose `data` is of this kind (a what-worked item to refresh, the learned casting weights). */
  readonly dataKind?: MemoryDataKind;
  /** Words to find in the text (FTS5, each word as a prefix), best match first. Absent: newest first. */
  readonly query?: string;
  /** 1..MEMORY_LIST_MAX. Default MEMORY_LIST_MAX. */
  readonly limit?: number;
}

export interface MemoryStore {
  /** core.conflict when the id exists; core.not_found (entity 'project' or 'template') when the scope's doesn't. */
  create(item: MemoryItem, context?: CommandContext): AsyncResult<MemoryItem>;
  /** core.conflict unless the stored revision is `expectedRevision`; core.not_found (entity 'memory') when gone. */
  put(item: MemoryItem, expectedRevision: number, context?: CommandContext): AsyncResult<MemoryItem>;
  /** core.not_found (entity 'memory'). */
  get(memoryId: MemoryId): AsyncResult<MemoryItem>;
  /** The items that match, with their scope's name, in the filter's order. */
  list(filter?: MemoryFilter): AsyncResult<MemoryItemView[]>;
  /** How many items match (`query` and `limit` ignored). */
  count(filter?: Omit<MemoryFilter, 'query' | 'limit'>): AsyncResult<number>;
  /** core.not_found (entity 'memory'). */
  remove(memoryId: MemoryId, context?: CommandContext): AsyncResult<void>;
}

export const MemoryStoreToken = createToken<MemoryStore>('core.memoryStore');
