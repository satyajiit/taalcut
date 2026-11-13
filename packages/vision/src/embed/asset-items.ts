// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One asset's vectors in the index (P2-L9, IX-E1). A set replaces the
 * asset's ids of the kinds it owns in one transaction (`replaceWhere`):
 * upserted, then the ids of those kinds that are not in it removed, so a
 * search never misses the asset in between and a crash leaves either set.
 * Each stage replaces only its own kinds: frame vectors (`vision.embed`)
 * never remove on-screen text (`vision.embedOcr`), transcript
 * (`vision.embedText`) or the descriptions `vision.describe` stores.
 */
import {
  EMBEDDING_ITEM_KINDS,
  ok,
  type AsyncResult,
  type EmbeddingItemKind,
  type Result,
  type VectorIndex,
  type VectorItem,
} from '@taalcut/core';
import type { VisionEmbedder } from './embedder';
import { withVectors } from './with-vectors';

export interface TextItem {
  readonly itemId: string;
  readonly kind: EmbeddingItemKind;
  readonly text: string;
}

/** Longer stored texts are cut here (the model's context is 8,192 tokens; a character is at most one). */
const MAX_TEXT_CHARS = 8192;

export function itemMetadata(assetId: string, sourceId: string, kind: EmbeddingItemKind) {
  return { assetId, sourceId, kind };
}

/** Document vectors for the non-empty texts of known kinds, in order. */
export async function embedTextItems(
  embedder: VisionEmbedder,
  input: { readonly assetId: string; readonly sourceId: string; readonly texts: readonly TextItem[] },
  signal: AbortSignal | undefined,
): AsyncResult<VectorItem[]> {
  const texts = input.texts.filter(
    (item) => item.text.trim() !== '' && EMBEDDING_ITEM_KINDS.includes(item.kind),
  );
  if (texts.length === 0) return ok([]);
  const vectors = await embedder.embedTexts(
    texts.map((item) => item.text.slice(0, MAX_TEXT_CHARS)),
    { purpose: 'document', ...(signal ? { signal } : {}) },
  );
  if (!vectors.ok) return vectors;
  const paired = withVectors(texts, vectors.value);
  if (!paired.ok) return paired;
  return ok(
    paired.value.map(({ item, vector }) => ({
      id: item.itemId,
      vector,
      metadata: itemMetadata(input.assetId, input.sourceId, item.kind),
    })),
  );
}

/**
 * Writes `items` in place of the asset's ids of the `replaces` kinds, in one
 * transaction. Returns how many were removed. With nothing new, every vector
 * of those kinds is stale. Every id of those kinds is listed, however many an
 * asset has (a search for them saw at most 4,096 until IX-F3).
 */
export function replaceAssetItems(
  index: VectorIndex,
  assetId: string,
  items: readonly VectorItem[],
  replaces: readonly EmbeddingItemKind[],
): Result<number> {
  if (replaces.length === 0) {
    const written = items.length > 0 ? index.upsert(items) : ok(0);
    return written.ok ? ok(0) : written;
  }
  return index.replaceWhere({ assetId, kind: [...replaces] }, items);
}
