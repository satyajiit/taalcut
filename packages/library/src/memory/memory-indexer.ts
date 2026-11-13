// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The memory index's writer (LRN1-MEM): one vector per item, its text embedded as a document, metadata `kind` =
 * the scope and `sourceId` = the project or template (core's MemoryIndexToken). It runs after a memory command
 * commits (`library.changed`, entity 'memory'), never inside one: embedding is an async call to the jobs process.
 *
 * The index is derived. `sync` writes the items it is told about; an item gone from the store loses its vector,
 * and one whose text can't be embedded now (the model is still downloading) loses its old vector too, so a stale
 * text never ranks. `reconcile` makes the index the store's set again in one `replaceWhere`: it embeds what the
 * index lacks and drops vectors with no item, so it catches up after a failure, after deletions a project or
 * template cascaded, and fills a new space's empty index.
 */
import {
  all,
  MEMORY_SCOPES,
  ok,
  type AsyncResult,
  type Embedder,
  type EventBus,
  type MemoryId,
  type MemoryItem,
  type Result,
  type VectorIndex,
  type VectorItem,
} from '@taalcut/core';
import { eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { rowItem } from './memory-rows';
import { memoryItems } from './memory-table';

/** The embedder takes at most this many texts per call (core's embeddingsContract). */
const BATCH = 64;

export interface MemoryIndexerDeps {
  readonly db: LibraryDatabase;
  readonly index: VectorIndex;
  readonly embedder: Embedder;
}

export interface MemoryIndexReport {
  readonly embedded: number;
  readonly removed: number;
  /** Items left without a vector because embedding failed; the next reconcile tries them again. */
  readonly pending: number;
}

export interface MemoryIndexer {
  sync(ids: readonly MemoryId[], signal?: AbortSignal): AsyncResult<MemoryIndexReport>;
  reconcile(signal?: AbortSignal): AsyncResult<MemoryIndexReport>;
  /** Syncs every committed memory change; a project or template deletion reconciles. Returns the unsubscribe. */
  follow(events: Pick<EventBus, 'on'>): () => void;
}

function vectorItem(item: Pick<MemoryItem, 'id' | 'scope'>, vector: Float32Array): VectorItem {
  const { scope } = item;
  const sourceId = scope.kind === 'project' ? scope.projectId : scope.kind === 'template' ? scope.templateId : null;
  return { id: item.id, vector, metadata: { kind: scope.kind, sourceId } };
}

/** Every stored item (the index holds them all, not a page of them). */
function allItems(db: LibraryDatabase): Result<MemoryItem[]> {
  return all(db.orm.select().from(memoryItems).all().map(rowItem));
}

export function createMemoryIndexer(deps: MemoryIndexerDeps): MemoryIndexer {
  const { db, index, embedder } = deps;

  /** The items' vectors, batch by batch; a batch the embedder refuses comes back in `failed`. */
  async function embed(items: readonly MemoryItem[], signal?: AbortSignal) {
    const done: VectorItem[] = [];
    const failed: MemoryItem[] = [];
    for (let start = 0; start < items.length; start += BATCH) {
      const batch = items.slice(start, start + BATCH);
      const vectors = await embedder.embedTexts(
        batch.map((item) => item.text),
        { purpose: 'document', ...(signal ? { signal } : {}) },
      );
      if (!vectors.ok) failed.push(...batch);
      else batch.forEach((item, i) => done.push(vectorItem(item, vectors.value[i]!)));
    }
    return { done, failed };
  }

  async function sync(ids: readonly MemoryId[], signal?: AbortSignal): AsyncResult<MemoryIndexReport> {
    const present: MemoryItem[] = [];
    const gone: MemoryId[] = [];
    for (const id of new Set(ids)) {
      const row = db.orm.select().from(memoryItems).where(eq(memoryItems.id, id)).get();
      if (!row) {
        gone.push(id);
        continue;
      }
      const item = rowItem(row);
      if (!item.ok) return item;
      present.push(item.value);
    }
    const { done, failed } = await embed(present, signal);
    const written = done.length > 0 ? index.upsert(done) : ok(0);
    if (!written.ok) return written;
    const stale = [...gone, ...failed.map((item) => item.id)];
    const removed = stale.length > 0 ? index.remove(stale) : ok(0);
    if (!removed.ok) return removed;
    return ok({ embedded: written.value, removed: removed.value, pending: failed.length });
  }

  async function reconcile(signal?: AbortSignal): AsyncResult<MemoryIndexReport> {
    const listed = allItems(db);
    if (!listed.ok) return listed;
    const items = listed.value;
    const stored = index.get(items.map((item) => item.id));
    if (!stored.ok) return stored;
    const kept = items.flatMap((item) => {
      const vector = stored.value.get(item.id);
      return vector ? [vectorItem(item, vector)] : [];
    });
    const { done, failed } = await embed(
      items.filter((item) => !stored.value.has(item.id)),
      signal,
    );
    // The store's set in place of the index's, atomically: what isn't among them (an orphan) goes.
    const removed = index.replaceWhere({ kind: [...MEMORY_SCOPES] }, [...kept, ...done]);
    if (!removed.ok) return removed;
    return ok({ embedded: done.length, removed: removed.value, pending: failed.length });
  }

  function follow(events: Pick<EventBus, 'on'>): () => void {
    return events.on('library.changed', ({ payload }) => {
      if (payload.entity === 'memory') void sync(payload.ids as MemoryId[]);
      else if ((payload.entity === 'project' || payload.entity === 'template') && payload.change === 'deleted')
        void reconcile();
    });
  }

  return { sync, reconcile, follow };
}
