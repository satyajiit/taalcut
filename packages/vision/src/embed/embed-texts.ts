// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Embeds one asset's stored texts without touching its media
 * (`vision.embedText`, IX-E1): transcript segments as document vectors,
 * replacing only the kinds the job owns, so the frame vectors `vision.embed`
 * wrote stay.
 */
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type EmbeddingItemKind,
  type VectorIndex,
} from '@taalcut/core';
import { embedTextItems, replaceAssetItems, type TextItem } from './asset-items';
import { checkSpace, type EmbedAssetContext } from './embed-asset';
import type { VisionEmbedder } from './embedder';

export interface EmbedTextsInput {
  readonly assetId: string;
  readonly sourceId: string;
  readonly texts: readonly TextItem[];
  /** The item kinds this set replaces. */
  readonly replaces: readonly EmbeddingItemKind[];
}

export async function embedAssetTexts(
  input: EmbedTextsInput,
  deps: { readonly embedder: VisionEmbedder; readonly index: VectorIndex },
  ctx: EmbedAssetContext = {},
): AsyncResult<{ space: VisionEmbedder['space']; texts: number; removed: number }> {
  const checked = checkSpace(deps.index, deps.embedder.space);
  if (!checked.ok) return checked;
  const items = await embedTextItems(deps.embedder, input, ctx.signal);
  if (!items.ok) return items;
  if (ctx.signal?.aborted) return err(CancelledError());
  const removed = replaceAssetItems(deps.index, input.assetId, items.value, input.replaces);
  if (!removed.ok) return removed;
  ctx.progress?.(1);
  return ok({ space: deps.embedder.space, texts: items.value.length, removed: removed.value });
}
