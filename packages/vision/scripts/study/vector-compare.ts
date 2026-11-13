// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How close one model's vectors are to another's for the same items (IX3-N2): the cosine of each item's pair, summed
 * up per kind (frame, transcript, ocr, query) as count, minimum, first percentile, median and mean, plus the worst
 * items by id. The bars (design C, int4): median ≥ 0.995 and minimum ≥ 0.98 for frames and texts.
 */
import { cosineDistance } from '../../src/embed/space';

export type Vectors = ReadonlyMap<string, Float32Array>;

export interface CosineSummary {
  readonly count: number;
  readonly min: number;
  readonly p1: number;
  readonly median: number;
  readonly mean: number;
  readonly worst: readonly { readonly id: string; readonly cosine: number }[];
}

/** The kind an item id names: its first segment (`frame:…`, `transcript:…`, `ocr:…`, `query:…`). */
export const kindOf = (id: string): string => id.slice(0, Math.max(0, id.indexOf(':'))) || id;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return (
    (sorted[low] ?? Number.NaN) + ((sorted[high] ?? Number.NaN) - (sorted[low] ?? Number.NaN)) * (at - low)
  );
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function summary(pairs: readonly { id: string; cosine: number }[]): CosineSummary {
  const sorted = pairs.map((p) => p.cosine).sort((a, b) => a - b);
  return {
    count: pairs.length,
    min: round(sorted[0] ?? Number.NaN),
    p1: round(quantile(sorted, 0.01)),
    median: round(quantile(sorted, 0.5)),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length)),
    worst: [...pairs]
      .sort((a, b) => a.cosine - b.cosine)
      .slice(0, 3)
      .map((p) => ({ id: p.id, cosine: round(p.cosine) })),
  };
}

/** Per kind and over frames and texts together (`all`); throws when the two sets don't hold the same ids. */
export function compareVectors(baseline: Vectors, candidate: Vectors): Record<string, CosineSummary> {
  const missing = [...baseline.keys()].filter((id) => !candidate.has(id));
  if (missing.length > 0 || candidate.size !== baseline.size)
    throw new Error(`the vector sets differ (${missing.length} missing, e.g. ${missing[0] ?? 'extra ids'})`);
  const byKind = new Map<string, { id: string; cosine: number }[]>();
  for (const [id, vector] of baseline) {
    const other = candidate.get(id);
    if (!other) continue;
    const pair = { id, cosine: 1 - cosineDistance(vector, other) };
    const kind = kindOf(id);
    byKind.set(kind, [...(byKind.get(kind) ?? []), pair]);
  }
  const out: Record<string, CosineSummary> = {};
  for (const [kind, pairs] of byKind) out[kind] = summary(pairs);
  out.all = summary([...byKind.entries()].filter(([kind]) => kind !== 'query').flatMap(([, pairs]) => pairs));
  return out;
}

/** Vectors as base64 float32 by id, for a JSON file the later steps (floors, duplicates) read back. */
export function vectorsJson(vectors: Vectors): Record<string, string> {
  return Object.fromEntries(
    [...vectors].map(([id, v]) => [id, Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')]),
  );
}
