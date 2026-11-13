// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A style profile's exemplars (LRN1-STY): the 1–3 members most typical of the set, as medoids over the template
 * index's slot-intent vectors. Each member's slot vectors are averaged into one unit vector (its centroid); the
 * distance between two members is 1 − the cosine of their centroids. A set of n members gets ⌈n / 4⌉ exemplars,
 * 1 to 3, chosen greedily (PAM's build step): first the member with the least total distance to all the others,
 * then each time the one that lowers the set's total distance to its nearest exemplar most. Every tie goes to the
 * smaller template id, and every sum runs in id order, so the same vectors always give the same exemplars.
 */
import { STYLE_PROFILE_MAX_EXEMPLARS, type TemplateId } from '@taalcut/core';
import { PROFILE_CONFIG } from './profile-config';

export interface SlotVectorSet {
  readonly templateId: TemplateId;
  /** The member's slot-intent vectors, in slot order (slots without intent words have none). */
  readonly vectors: readonly Float32Array[];
}

/** The unit mean of the unit slot vectors; null without any (or when they cancel out). */
export function centroid(vectors: readonly Float32Array[]): Float64Array | null {
  const first = vectors[0];
  if (!first) return null;
  const sum = new Float64Array(first.length);
  for (const vector of vectors) {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) norm += (vector[i] ?? 0) ** 2;
    if (norm === 0) continue;
    const scale = 1 / Math.sqrt(norm);
    for (let i = 0; i < sum.length; i++) sum[i] = (sum[i] ?? 0) + (vector[i] ?? 0) * scale;
  }
  let length = 0;
  for (const value of sum) length += value * value;
  if (length === 0) return null;
  const scale = 1 / Math.sqrt(length);
  return sum.map((value) => value * scale);
}

/** How many exemplars a pool of n members gets: ⌈n / 4⌉, between 1 and 3 (none for an empty pool). */
export function exemplarCount(pool: number): number {
  if (pool === 0) return 0;
  return Math.min(
    STYLE_PROFILE_MAX_EXEMPLARS,
    Math.max(1, Math.ceil(pool / PROFILE_CONFIG.membersPerExemplar)),
  );
}

const byId = (a: SlotVectorSet, b: SlotVectorSet) =>
  a.templateId < b.templateId ? -1 : a.templateId > b.templateId ? 1 : 0;

/** 1 − cosine between every pair of centroids (unit vectors), as an n × n matrix. */
function distances(centroids: readonly Float64Array[]): Float64Array {
  const n = centroids.length;
  const matrix = new Float64Array(n * n);
  centroids.forEach((a, i) => {
    for (let j = i + 1; j < n; j++) {
      const b = centroids[j];
      if (!b) continue;
      let dot = 0;
      for (let k = 0; k < a.length; k++) dot += (a[k] ?? 0) * (b[k] ?? 0);
      const distance = Math.max(0, 1 - dot);
      matrix[i * n + j] = distance;
      matrix[j * n + i] = distance;
    }
  });
  return matrix;
}

/**
 * PAM's build step: the member not chosen yet that, made an exemplar, leaves the lowest total distance from every
 * member to its nearest exemplar. `nearest` holds each member's distance to its nearest exemplar so far.
 */
function nextMedoid(matrix: Float64Array, nearest: Float64Array, chosen: readonly number[]): number {
  const n = nearest.length;
  let best = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let candidate = 0; candidate < n; candidate++) {
    if (chosen.includes(candidate)) continue;
    let cost = 0;
    for (let member = 0; member < n; member++)
      cost += Math.min(nearest[member] ?? 0, matrix[member * n + candidate] ?? 0);
    // Strictly lower only: an equal cost keeps the earlier (smaller) id.
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * The medoids of the members with slot vectors, most typical first. Members whose vectors give no centroid are
 * left out of the pool. Returns the pool's size too: the exemplars were chosen from that many members.
 */
export function medoids(sets: readonly SlotVectorSet[]): {
  readonly ids: TemplateId[];
  readonly pool: number;
} {
  const pool = [...sets].sort(byId).flatMap((set) => {
    const centre = centroid(set.vectors);
    return centre ? [{ id: set.templateId, centre }] : [];
  });
  const n = pool.length;
  const wanted = exemplarCount(n);
  if (wanted === 0) return { ids: [], pool: 0 };
  const matrix = distances(pool.map((member) => member.centre));
  // Each member's distance to its nearest chosen exemplar; Infinity before the first is chosen.
  const nearest = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const chosen: number[] = [];
  while (chosen.length < wanted) {
    const best = nextMedoid(matrix, nearest, chosen);
    chosen.push(best);
    for (let member = 0; member < n; member++)
      nearest[member] = Math.min(nearest[member] ?? 0, matrix[member * n + best] ?? 0);
  }
  return { ids: chosen.flatMap((index) => pool[index]?.id ?? []), pool: n };
}
