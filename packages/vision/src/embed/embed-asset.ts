// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Embeds one asset's frames and text into the active space's VectorIndex
 * (P2-L9). Re-embedding upserts the new set first and only then removes the
 * asset's ids of the kinds the set replaces that are not in it, so a search
 * never misses the asset in between (asset-items.ts). Idempotent: ids are
 * stable, so a re-run after a crash replaces vectors instead of adding them.
 */
import {
  CancelledError,
  EMBEDDING_ITEM_KINDS,
  err,
  ok,
  type AsyncResult,
  type EmbeddingItemKind,
  type EmbeddingSpace,
  type Result,
  type VectorIndex,
  type VectorItem,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { SpaceMismatch } from '../errors';
import type { FrameSource } from '../media/frame-source';
import { probeSource, sampleFrames, type SampledFrame } from '../media/frames';
import { embedTextItems, itemMetadata, replaceAssetItems, type TextItem } from './asset-items';
import type { VisionEmbedder } from './embedder';
import { EMBEDDING_SPACE } from './space';
import { withVectors } from './with-vectors';

export interface EmbedAssetInput {
  readonly assetId: string;
  readonly sourceId: string;
  readonly path: string;
  /** Grid frames to embed, per shot. Stills: one shot with frame 0. */
  readonly frames: readonly { readonly shotId: string; readonly frames: readonly number[] }[];
  /** Stored text: on-screen text tracks, transcript segments, descriptions. */
  readonly texts: readonly TextItem[];
  /**
   * The item kinds this set writes and replaces: the asset's other ids of these kinds are removed, and frames or
   * texts of other kinds are left out. Default: every kind. A `vision.embedAsset` job queued before the split carries
   * none; its handler runs it as the frame job (jobs/index-handlers.ts).
   */
  readonly replaces?: readonly EmbeddingItemKind[];
}

export interface EmbedAssetOutput {
  readonly space: EmbeddingSpace;
  readonly frames: number;
  readonly texts: number;
  /** Ids of this asset (of the replaced kinds) that were in the index and are not in the new set. */
  readonly removed: number;
}

export interface EmbedAssetDeps {
  readonly media: MediaContext;
  readonly embedder: VisionEmbedder;
  readonly index: VectorIndex;
  /**
   * The asset's frame source (IX-D1): frames from its cache where an earlier stage left them (the cut pairs shot
   * detection embedded), the rest decoded in grouped seeks. Absent: probe and decode here, as before IX.
   */
  readonly frames?: FrameSource;
}

export interface EmbedAssetContext {
  readonly signal?: AbortSignal;
  progress?(fraction: number): void;
}

/** `vision.space_mismatch` unless the index is this space's (name and width). Never mix spaces. */
export function checkSpace(index: VectorIndex, space: EmbeddingSpace = EMBEDDING_SPACE): Result<void> {
  if (index.name === space.indexName && index.dimensions === space.dimensions) return ok(undefined);
  return err(
    SpaceMismatch({
      expected: `${space.indexName}/${space.dimensions}`,
      actual: `${index.name}/${index.dimensions}`,
    }),
  );
}

export function frameItemId(shotId: string, n: number): string {
  return `frame:${shotId}:${n}`;
}

/** Grid frames at the embedder's index frame size (rgb24, ascending): through the frame source, else decoded here. */
async function readFrames(
  path: string,
  frames: readonly number[],
  deps: EmbedAssetDeps,
  signal: AbortSignal | undefined,
): AsyncResult<SampledFrame[]> {
  if (deps.frames) {
    const { width, height } = deps.frames.video;
    const size = await deps.embedder.frameSize(width, height, 'index');
    return deps.frames.frames({ size, format: 'rgb24', frames }, signal);
  }
  const source = await probeSource(deps.media, path, signal);
  if (!source.ok) return source;
  return sampleFrames(deps.media, source.value, {
    size: await deps.embedder.frameSize(source.value.width, source.value.height, 'index'),
    format: 'rgb24',
    frames,
    ...(signal ? { signal } : {}),
  });
}

/** The frame vectors of one asset, decoded at the embedder's index frame size. */
async function embedFrameItems(
  input: EmbedAssetInput,
  deps: EmbedAssetDeps,
  signal: AbortSignal | undefined,
): AsyncResult<VectorItem[]> {
  const wanted = input.frames.flatMap((shot) =>
    shot.frames.map((frame, n) => ({ id: frameItemId(shot.shotId, n), frame })),
  );
  if (wanted.length === 0) return ok([]);
  const sampled = await readFrames(
    input.path,
    wanted.map((item) => item.frame),
    deps,
    signal,
  );
  if (!sampled.ok) return sampled;
  const byIndex = new Map(sampled.value.map((frame) => [frame.index, frame]));
  const present = wanted.flatMap((item) => {
    const frame = byIndex.get(item.frame);
    return frame
      ? [{ id: item.id, image: { width: frame.width, height: frame.height, rgb: frame.data } }]
      : [];
  });
  const vectors = await deps.embedder.embedImages(
    present.map((item) => item.image),
    signal ? { signal } : {},
  );
  if (!vectors.ok) return vectors;
  const metadata = itemMetadata(input.assetId, input.sourceId, 'frame');
  const paired = withVectors(present, vectors.value);
  if (!paired.ok) return paired;
  return ok(paired.value.map(({ item, vector }) => ({ id: item.id, vector, metadata })));
}

export async function embedAsset(
  input: EmbedAssetInput,
  deps: EmbedAssetDeps,
  ctx: EmbedAssetContext = {},
): AsyncResult<EmbedAssetOutput> {
  const checked = checkSpace(deps.index, deps.embedder.space);
  if (!checked.ok) return checked;
  const signal = ctx.signal;
  const replaces = input.replaces ?? EMBEDDING_ITEM_KINDS;
  // A set writes only the kinds it replaces: the others are other stages' vectors.
  const frames = replaces.includes('frame') ? await embedFrameItems(input, deps, signal) : ok([]);
  if (!frames.ok) return frames;
  ctx.progress?.(0.8);
  const ownTexts = input.texts.filter((item) => replaces.includes(item.kind));
  const texts = await embedTextItems(deps.embedder, { ...input, texts: ownTexts }, signal);
  if (!texts.ok) return texts;
  if (signal?.aborted) return err(CancelledError());

  const items = [...frames.value, ...texts.value];
  const removed = replaceAssetItems(deps.index, input.assetId, items, replaces);
  if (!removed.ok) return removed;
  ctx.progress?.(1);
  return ok({
    space: deps.embedder.space,
    frames: frames.value.length,
    texts: texts.value.length,
    removed: removed.value,
  });
}
