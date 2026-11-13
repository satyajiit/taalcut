// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Exact cosines between slot intents and a pool of shots, in memory (LRN1-TPL fit). Both sides are unit vectors in
 * the active embedding space, so a cosine is a dot product. The pool is packed once into one row-major block, and
 * each distinct intent (by its text's digest: two templates with the same words share a vector) is scored against
 * every shot once. 200 templates of 8 slots against 500 shots of 768 dimensions is about 0.6 G multiply-adds.
 *
 * This is the same accepted ADR 0002 exception as casting's catalogue: exact search on the CPU over the library's
 * vectors. There is no GPU path for a few hundred thousand dot products that beats the copy to the GPU.
 */

/** The pool's vectors in one block: row `i` is shot `i`'s unit embedding. */
export interface PackedPool {
  readonly rows: number;
  readonly dimensions: number;
  readonly data: Float32Array;
}

export function packPool(embeddings: readonly Float32Array[], dimensions: number): PackedPool {
  const data = new Float32Array(embeddings.length * dimensions);
  embeddings.forEach((vector, row) => data.set(vector.subarray(0, dimensions), row * dimensions));
  return { rows: embeddings.length, dimensions, data };
}

/**
 * Every shot's cosine to `query`, in pool order, in doubles as casting's `dot` sums them (only the order of the
 * additions differs, by far less than casting's tie epsilon). Unrolled by four: about twice a plain loop's speed.
 */
export function cosinesTo(query: Float32Array, pool: PackedPool): Float64Array {
  const { rows, dimensions, data } = pool;
  const out = new Float64Array(rows);
  const tail = dimensions - (dimensions % 4);
  for (let row = 0; row < rows; row++) {
    const base = row * dimensions;
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    let i = 0;
    for (; i < tail; i += 4) {
      a += (query[i] as number) * (data[base + i] as number);
      b += (query[i + 1] as number) * (data[base + i + 1] as number);
      c += (query[i + 2] as number) * (data[base + i + 2] as number);
      d += (query[i + 3] as number) * (data[base + i + 3] as number);
    }
    for (; i < dimensions; i++) a += (query[i] as number) * (data[base + i] as number);
    out[row] = a + b + c + d;
  }
  return out;
}

/** Cosines per distinct intent, computed once each and shared by every slot with the same words. */
export function createCosineTable(pool: PackedPool) {
  const table = new Map<string, Float64Array>();
  return {
    of(digest: string, vector: Float32Array): Float64Array {
      let cosines = table.get(digest);
      if (!cosines) {
        cosines = cosinesTo(vector, pool);
        table.set(digest, cosines);
      }
      return cosines;
    },
  };
}
