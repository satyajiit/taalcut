// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Scoring and fitting for the duplicate-threshold study (IX2-E2). The rule is the shipped one (`isSameMoment`); a
 * budget's thresholds are 280's moved by how much that budget shrinks the distance between two frames: `k`, the
 * least-squares slope through the origin of the budget's cosine distance on 280's over the labelled pairs closer
 * than 0.3 at 280 (the region the thresholds live in), so a 280 threshold `t` becomes `1 − k·(1 − t)`.
 */
import { isSameMoment, type DuplicateThresholds } from '../../src/analysis/duplicates';

export interface ScoredPair {
  readonly kind: string;
  readonly duplicate: boolean;
  readonly bits: number;
  /** Cosine similarity of the two frames' vectors at each budget. */
  readonly similarity: Readonly<Record<number, number>>;
}

export interface RuleScore {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  /** Pairs grouped, by kind (duplicate kinds should be 1, the others 0). */
  readonly groupedByKind: Record<string, number>;
  /** Share of pairs decided as the reference decided them. */
  readonly agreement?: number;
}

export function decide(pairs: readonly ScoredPair[], budget: number, t: DuplicateThresholds): boolean[] {
  return pairs.map((p) => isSameMoment(p.similarity[budget] ?? 0, p.bits, t));
}

export function scoreRule(
  pairs: readonly ScoredPair[],
  decided: readonly boolean[],
  reference?: readonly boolean[],
): RuleScore {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const counts: Record<string, { grouped: number; all: number }> = {};
  pairs.forEach((p, i) => {
    const grouped = decided[i] === true;
    if (grouped && p.duplicate) tp++;
    if (grouped && !p.duplicate) fp++;
    if (!grouped && p.duplicate) fn++;
    const entry = (counts[p.kind] ??= { grouped: 0, all: 0 });
    entry.all++;
    if (grouped) entry.grouped++;
  });
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const share = (n: number, d: number) => Number((d === 0 ? 0 : n / d).toFixed(3));
  return {
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    f1: Number(((2 * precision * recall) / Math.max(1e-9, precision + recall)).toFixed(3)),
    groupedByKind: Object.fromEntries(Object.entries(counts).map(([k, c]) => [k, share(c.grouped, c.all)])),
    ...(reference
      ? { agreement: share(decided.filter((d, i) => d === reference[i]).length, decided.length) }
      : {}),
  };
}

/** How much `budget` shrinks distances against `reference` (see the module comment). */
export function distanceScale(pairs: readonly ScoredPair[], budget: number, reference: number): number {
  let xy = 0;
  let xx = 0;
  for (const p of pairs) {
    const x = 1 - (p.similarity[reference] ?? 1);
    const y = 1 - (p.similarity[budget] ?? 1);
    if (x >= 0.3) continue;
    xy += x * y;
    xx += x * x;
  }
  return xx === 0 ? 1 : xy / xx;
}

export function scaledThresholds(t: DuplicateThresholds, k: number): DuplicateThresholds {
  const move = (similarity: number) => Number((1 - k * (1 - similarity)).toFixed(3));
  return {
    cosine: move(t.cosine),
    cosineAlone: move(t.cosineAlone),
    cosineWithSameHash: move(t.cosineWithSameHash),
  };
}

/** The lowest similarity among duplicate pairs and the highest among the others, per budget (how much room there is). */
export function margins(pairs: readonly ScoredPair[], budget: number) {
  const sims = (duplicate: boolean) =>
    pairs.filter((p) => p.duplicate === duplicate).map((p) => p.similarity[budget] ?? 0);
  const round = (n: number) => Number(n.toFixed(4));
  return {
    lowestDuplicate: round(Math.min(...sims(true))),
    highestOther: round(Math.max(...sims(false))),
  };
}
