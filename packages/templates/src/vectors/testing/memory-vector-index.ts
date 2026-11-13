// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An exact in-memory VectorIndex (cosine, unit vectors stored) for tests of the template index and fit: the
 * library's sqlite-vec index can't be imported by templates or timeline. Behaves like it where tests look: upserts
 * replace by id, `replaceWhere` keeps the given ids, an empty filter list matches nothing, `ids` lists by filter.
 */
import {
  err,
  ok,
  ValidationError,
  type VectorFilter,
  type VectorIndex,
  type VectorItem,
  type VectorMatch,
} from '@taalcut/core';

interface Row {
  readonly vector: Float32Array;
  readonly assetId: string | null;
  readonly sourceId: string | null;
  readonly kind: string | null;
}

function matches(row: Row, filter: VectorFilter | undefined): boolean {
  if (!filter) return true;
  const test = (value: string | null, wanted: string | readonly string[] | undefined) =>
    wanted === undefined || (typeof wanted === 'string' ? value === wanted : wanted.includes(value ?? ''));
  return (
    test(row.assetId, filter.assetId) && test(row.sourceId, filter.sourceId) && test(row.kind, filter.kind)
  );
}

const isEmpty = (filter: VectorFilter) =>
  filter.assetId === undefined && filter.sourceId === undefined && filter.kind === undefined;

function unit(values: Float32Array | readonly number[]): Float32Array {
  const vector = Float32Array.from(values);
  const norm = Math.hypot(...vector);
  return norm > 0 ? vector.map((value) => value / norm) : vector;
}

export interface MemoryVectorIndex extends VectorIndex {
  /** Every write call, for tests that count them. */
  readonly writes: { upserted: number; replaced: number };
}

export function createMemoryVectorIndex(name: string, dimensions: number): MemoryVectorIndex {
  const rows = new Map<string, Row>();
  const writes = { upserted: 0, replaced: 0 };
  const upsert = (items: readonly VectorItem[]) => {
    for (const item of items) {
      if (item.vector.length !== dimensions) return err(ValidationError({ field: 'vector' }));
    }
    for (const item of items) {
      rows.set(item.id, {
        vector: unit(item.vector),
        assetId: item.metadata?.assetId ?? null,
        sourceId: item.metadata?.sourceId ?? null,
        kind: item.metadata?.kind ?? null,
      });
    }
    writes.upserted += items.length;
    return ok(items.length);
  };
  const idsWhere = (filter?: VectorFilter) =>
    [...rows].flatMap(([id, row]) => (matches(row, filter) ? [id] : []));
  const removeIds = (ids: readonly string[]) => ok(ids.filter((id) => rows.delete(id)).length);

  return {
    name,
    dimensions,
    metric: 'cosine',
    writes,
    upsert,
    remove: removeIds,
    removeWhere: (filter) =>
      isEmpty(filter)
        ? err(ValidationError({ field: 'filter' }, { detail: 'refusing to remove everything' }))
        : removeIds(idsWhere(filter)),
    replaceWhere(filter, items) {
      if (isEmpty(filter))
        return err(ValidationError({ field: 'filter' }, { detail: 'refusing to replace everything' }));
      const written = upsert(items);
      if (!written.ok) return written;
      writes.replaced++;
      const keep = new Set(items.map((item) => item.id));
      return removeIds(idsWhere(filter).filter((id) => !keep.has(id)));
    },
    ids: (filter) => ok(idsWhere(filter)),
    search(query, options) {
      const q = unit(query);
      const found: VectorMatch[] = [];
      for (const [id, row] of rows) {
        if (!matches(row, options.filter)) continue;
        let dot = 0;
        for (let i = 0; i < dimensions; i++) dot += (q[i] as number) * (row.vector[i] as number);
        found.push({
          id,
          distance: 1 - dot,
          metadata: { assetId: row.assetId, sourceId: row.sourceId, kind: row.kind },
        });
      }
      return ok(found.sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1)).slice(0, options.k));
    },
    get(ids) {
      const found = new Map<string, Float32Array>();
      for (const id of ids) {
        const row = rows.get(id);
        if (row) found.set(id, Float32Array.from(row.vector));
      }
      return ok(found);
    },
    count: () => rows.size,
    drop() {
      rows.clear();
      return ok(undefined);
    },
  };
}
