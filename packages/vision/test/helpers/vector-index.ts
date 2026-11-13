// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** An exact in-memory VectorIndex (cosine) for tests: library's sqlite-vec index is not importable here. */
import {
  ok,
  type Embedder,
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

export function memoryVectorIndex(
  name: string,
  dimensions: number,
): VectorIndex & { readonly rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const upsert = (items: readonly VectorItem[]) => {
    for (const item of items) {
      rows.set(item.id, {
        vector: Float32Array.from(item.vector),
        assetId: item.metadata?.assetId ?? null,
        sourceId: item.metadata?.sourceId ?? null,
        kind: item.metadata?.kind ?? null,
      });
    }
    return ok(items.length);
  };
  /** Removes the rows the filter matches, except `keep`'s. */
  const removeMatching = (filter: VectorFilter, keep: ReadonlySet<string> = new Set()) => {
    let n = 0;
    for (const [id, row] of rows) if (!keep.has(id) && matches(row, filter) && rows.delete(id)) n++;
    return ok(n);
  };
  return {
    name,
    dimensions,
    metric: 'cosine',
    rows,
    upsert,
    remove(ids) {
      let n = 0;
      for (const id of ids) if (rows.delete(id)) n++;
      return ok(n);
    },
    removeWhere: (filter) => removeMatching(filter),
    ids: (filter) => ok([...rows].flatMap(([id, row]) => (matches(row, filter) ? [id] : []))),
    replaceWhere(filter, items) {
      upsert(items);
      return removeMatching(filter, new Set(items.map((item) => item.id)));
    },
    search(query, options) {
      const q = Float32Array.from(query);
      const out: VectorMatch[] = [];
      for (const [id, row] of rows) {
        if (!matches(row, options.filter)) continue;
        let dot = 0;
        let qq = 0;
        let rr = 0;
        for (let i = 0; i < q.length; i++) {
          dot += (q[i] ?? 0) * (row.vector[i] ?? 0);
          qq += (q[i] ?? 0) ** 2;
          rr += (row.vector[i] ?? 0) ** 2;
        }
        const distance = 1 - dot / Math.sqrt(qq * rr || 1);
        out.push({
          id,
          distance,
          metadata: { assetId: row.assetId, sourceId: row.sourceId, kind: row.kind },
        });
      }
      return ok(out.sort((a, b) => a.distance - b.distance).slice(0, options.k));
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

/** The id of `assetId`'s item nearest to `query` embedded as a search query, or undefined. */
export async function topHit(
  embedder: Pick<Embedder, 'embedTexts'>,
  index: VectorIndex,
  query: string,
  assetId: string,
): Promise<string | undefined> {
  const vector = await embedder.embedTexts([query], { purpose: 'query' });
  if (!vector.ok) throw new Error(vector.error.code);
  const [first] = vector.value;
  if (!first) return undefined;
  const found = index.search(first, { k: 1, filter: { assetId } });
  return found.ok ? found.value[0]?.id : undefined;
}
