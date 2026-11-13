// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Near-duplicates and the best take (G25 basic). Candidates are shots from
 * the same source within 10 minutes of capture time and with the same
 * orientation. Two are duplicates when their best frames' embeddings are
 * close (cosine ≥ 0.92 at 280 tokens) and their dHashes agree (Hamming ≤ 10
 * of 64), or the embeddings alone are very close (≥ 0.96: a burst with
 * motion), or the dHashes nearly match (≤ 6) and the embeddings are fairly
 * close (≥ 0.85: the same moment, blurred or badly exposed). Fewer image
 * tokens per frame pull frames closer together, so the cosine thresholds are
 * per budget (VISION_CONFIG.duplicates.similarity, IX2-E2). Groups are
 * connected components; the best take is the highest overall quality, then
 * the longer shot, then the earlier capture.
 */
import type { Orientation } from '@taalcut/core';
import { VISION_CONFIG } from '../config';
import type { ImageTokenBudget } from '../embed/space';
import { hamming } from '../quality/frame-stats';

export interface DuplicateCandidate {
  readonly shotId: string;
  readonly assetId: string;
  readonly sourceId: string;
  /** Capture time in ms since the epoch, or null when the file didn't say. */
  readonly capturedAt: number | null;
  readonly durationMs: number;
  readonly overall: number;
  readonly dHash: string;
  readonly orientation: Orientation;
}

export interface NearDuplicateGroup {
  /** The best take's shot id: stable while the best take stays the best. */
  readonly groupId: string;
  readonly shotIds: readonly string[];
  readonly bestShotId: string;
}

const d = VISION_CONFIG.duplicates;

/** The cosine similarities the rule needs, for one image-token budget. */
export interface DuplicateThresholds {
  /** With dHashes that agree (Hamming ≤ `hamming`). */
  readonly cosine: number;
  /** On its own. */
  readonly cosineAlone: number;
  /** With near-identical dHashes (Hamming ≤ `hashOnly`). */
  readonly cosineWithSameHash: number;
}

/** The thresholds fitted for frames embedded at `budget` soft tokens. */
export function duplicateThresholds(budget: ImageTokenBudget): DuplicateThresholds {
  return d.similarity[budget];
}

/** The rule on one pair's cosine similarity and dHash Hamming distance. */
export function isSameMoment(similarity: number, bits: number, t: DuplicateThresholds): boolean {
  return (
    (similarity >= t.cosine && bits <= d.hamming) ||
    (similarity >= t.cosineWithSameHash && bits <= d.hashOnly) ||
    similarity >= t.cosineAlone
  );
}

function comparable(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  if (a.sourceId !== b.sourceId || a.orientation !== b.orientation) return false;
  if (a.capturedAt === null || b.capturedAt === null) return a.assetId === b.assetId;
  return Math.abs(a.capturedAt - b.capturedAt) <= d.windowMs;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    aa += (a[i] ?? 0) ** 2;
    bb += (b[i] ?? 0) ** 2;
  }
  return dot / Math.sqrt(aa * bb || 1);
}

/** Whether two comparable shots are the same moment, by the rule above. */
export function duplicates(
  a: DuplicateCandidate,
  b: DuplicateCandidate,
  va: Float32Array | undefined,
  vb: Float32Array | undefined,
  thresholds: DuplicateThresholds,
): boolean {
  const bits = hamming(a.dHash, b.dHash);
  if (!va || !vb) return bits <= d.hashOnly;
  return isSameMoment(cosine(va, vb), bits, thresholds);
}

function better(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  if (a.overall !== b.overall) return a.overall > b.overall;
  if (a.durationMs !== b.durationMs) return a.durationMs > b.durationMs;
  const at = a.capturedAt ?? Number.MAX_SAFE_INTEGER;
  const bt = b.capturedAt ?? Number.MAX_SAFE_INTEGER;
  if (at !== bt) return at < bt;
  return a.shotId < b.shotId;
}

/**
 * Groups of two or more near-duplicate shots, each with its best take. `vectors` by shot id, embedded at the budget
 * `thresholds` were fitted for.
 */
export function groupNearDuplicates(
  shots: readonly DuplicateCandidate[],
  vectors: ReadonlyMap<string, Float32Array>,
  thresholds: DuplicateThresholds,
): NearDuplicateGroup[] {
  const parent = shots.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  // Sorting by source then time keeps the comparisons local; the window check stops early.
  const order = shots
    .map((shot, i) => ({ shot, i }))
    .sort(
      (x, y) =>
        x.shot.sourceId.localeCompare(y.shot.sourceId) || (x.shot.capturedAt ?? 0) - (y.shot.capturedAt ?? 0),
    );
  for (let x = 0; x < order.length; x++) {
    const a = order[x]!;
    for (let y = x + 1; y < order.length; y++) {
      const b = order[y]!;
      if (b.shot.sourceId !== a.shot.sourceId) break;
      if (
        a.shot.capturedAt !== null &&
        b.shot.capturedAt !== null &&
        b.shot.capturedAt - a.shot.capturedAt > d.windowMs
      )
        break;
      if (!comparable(a.shot, b.shot)) continue;
      if (duplicates(a.shot, b.shot, vectors.get(a.shot.shotId), vectors.get(b.shot.shotId), thresholds)) {
        parent[find(a.i)] = find(b.i);
      }
    }
  }
  const members = new Map<number, DuplicateCandidate[]>();
  shots.forEach((shot, i) => {
    const root = find(i);
    members.set(root, [...(members.get(root) ?? []), shot]);
  });
  const groups: NearDuplicateGroup[] = [];
  for (const group of members.values()) {
    if (group.length < 2) continue;
    let best = group[0]!;
    for (const shot of group) if (better(shot, best)) best = shot;
    groups.push({
      groupId: best.shotId,
      shotIds: group.map((s) => s.shotId).sort(),
      bestShotId: best.shotId,
    });
  }
  return groups.sort((a, b) => a.groupId.localeCompare(b.groupId));
}
