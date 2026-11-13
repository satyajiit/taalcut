// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Deterministic test data for the vector index. */

/** mulberry32: a small seeded PRNG returning floats in [-0.5, 0.5). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

/** 1 − cosine similarity. */
export function cosineDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return 1 - dot / Math.sqrt(na * nb);
}

/** Keeps the k smallest (distance, id) pairs seen. */
export class TopK {
  private readonly items: { id: string; distance: number }[] = [];
  constructor(private readonly k: number) {}

  offer(id: string, distance: number): void {
    if (this.items.length === this.k && distance >= this.items[this.k - 1]!.distance) return;
    this.items.push({ id, distance });
    this.items.sort((a, b) => a.distance - b.distance);
    if (this.items.length > this.k) this.items.pop();
  }

  ids(): string[] {
    return this.items.map((i) => i.id);
  }
}
