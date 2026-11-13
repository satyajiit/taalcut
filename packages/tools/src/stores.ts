// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * In-memory implementations of the executor's stores. They are the defaults
 * and what tests use; durable versions (SQLite, disk) come with the agent.
 * Each is a bounded LRU so a long session can't grow without limit.
 */
import {
  err,
  newId,
  NotFoundError,
  ok,
  type ArtifactId,
  type ArtifactStore,
  type StoredArtifact,
} from '@taalcut/core';
import type { CachedToolOutput, IdempotencyStore, IdempotentOutcome, ToolResultCache } from './ports';

class Lru<V> {
  private readonly items = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.items.get(key);
    if (value !== undefined) {
      this.items.delete(key);
      this.items.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.items.delete(key);
    this.items.set(key, value);
    if (this.items.size > this.max) this.items.delete(this.items.keys().next().value!);
  }

  delete(key: string): void {
    this.items.delete(key);
  }
}

export function createMemoryToolCache(
  options: { maxEntries?: number; now?: () => number } = {},
): ToolResultCache {
  const now = options.now ?? Date.now;
  const lru = new Lru<{ entry: CachedToolOutput; expiresAt: number }>(options.maxEntries ?? 500);
  return {
    async get(hash) {
      const hit = lru.get(hash);
      if (!hit) return undefined;
      if (hit.expiresAt <= now()) {
        lru.delete(hash);
        return undefined;
      }
      return hit.entry;
    },
    async set(hash, entry, ttlMs) {
      lru.set(hash, { entry, expiresAt: ttlMs === undefined ? Infinity : now() + ttlMs });
    },
  };
}

export function createMemoryIdempotencyStore(options: { maxEntries?: number } = {}): IdempotencyStore {
  const lru = new Lru<IdempotentOutcome>(options.maxEntries ?? 1000);
  return {
    get: async (key) => lru.get(key),
    set: async (key, outcome) => lru.set(key, outcome),
  };
}

/** Artifacts in memory, for tests and for runs with no library open. */
export function createMemoryArtifactStore(): ArtifactStore {
  const items = new Map<ArtifactId, StoredArtifact>();
  return {
    async put(artifact) {
      const data =
        typeof artifact.data === 'string' ? new TextEncoder().encode(artifact.data) : artifact.data;
      const ref = {
        id: newId<'Artifact'>(),
        mediaType: artifact.mediaType,
        bytes: data.byteLength,
        summary: artifact.summary,
      };
      items.set(ref.id, { ref, data });
      return ok(ref);
    },
    async get(id) {
      const found = items.get(id);
      return found ? ok(found) : err(NotFoundError({ entity: 'artifact', id }));
    },
  };
}
