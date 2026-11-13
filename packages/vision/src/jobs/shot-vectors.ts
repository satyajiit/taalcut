// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Vectors keyed by shot id, kept to the asset's current shots (IX2-C5). New shots (a better detector) keep the
 * ids of shots that start where they did and drop the rest, and the pipeline re-runs every stage that reads the
 * shots (dependent invalidation, IX3-I3). Frame vectors are replaced whole by `vision.embed`, and on-screen text vectors
 * by `vision.embedOcr` or, when no shot shows text any more, removed by `vision.ocr`. Descriptions are written
 * shot by shot, and a run may describe none (no model, no consent): `keepShotVectors` writes the new ones and
 * keeps exactly the current shots' others, read back from the index, so a vector of a shot that is gone goes
 * and a current shot's stays.
 */
import type { EmbeddingItemKind, Result, VectorIndex, VectorItem } from '@taalcut/core';

export interface ShotVectorSet {
  readonly assetId: string;
  readonly sourceId: string | null;
  readonly kind: EmbeddingItemKind;
  /** Every id the asset's current shots may have of this kind. */
  readonly current: readonly string[];
  /** New vectors (ids among `current`). */
  readonly items: readonly VectorItem[];
}

/** Writes `items` and removes the asset's vectors of the kind that aren't the current shots'. Returns how many went. */
export function keepShotVectors(index: VectorIndex, set: ShotVectorSet): Result<number> {
  const written = new Set(set.items.map((item) => item.id));
  const others = set.current.filter((id) => !written.has(id));
  const stored = index.get(others);
  if (!stored.ok) return stored;
  const metadata = { assetId: set.assetId, sourceId: set.sourceId, kind: set.kind };
  const kept: VectorItem[] = [...stored.value].map(([id, vector]) => ({ id, vector, metadata }));
  return index.replaceWhere({ assetId: set.assetId, kind: set.kind }, [...set.items, ...kept]);
}
