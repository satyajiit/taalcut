// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The takes `images.generateForSlot` made: each kept in the library byte for byte through core's
 * GeneratedAssetSink (provenance `generated`, the prompt's hash, never the prompt) with a preview artifact
 * for the card, and the `imageTakes` card that shows them.
 */
import {
  idSchema,
  ok,
  type ArtifactStore,
  type AsyncResult,
  type GeneratedAssetSink,
  type ToolCardContext,
} from '@taalcut/core';
import { imageExtension } from './image-bytes';
import type { GenerateForSlotInput, GenerateForSlotOutput, KeptTake } from './image-tool-io';
import type { GeneratedImage } from './image-types';

/** What every take of one call shares. */
export interface TakeContext {
  readonly input: GenerateForSlotInput;
  readonly ctx: {
    readonly callId: string;
    readonly runId?: string;
    readonly signal: AbortSignal;
    readonly artifacts: ArtifactStore;
  };
  readonly promptSha256: string;
  /** Each take's createdAt. */
  readonly now: () => number;
}

/** Keeps every take in order; the first that can't be kept stops the rest. */
export async function keepTakes(
  sink: GeneratedAssetSink,
  images: readonly GeneratedImage[],
  at: TakeContext,
): AsyncResult<KeptTake[]> {
  const kept: KeptTake[] = [];
  for (const [index, image] of images.entries()) {
    const take = await keepTake(sink, image, index, images.length, at);
    if (!take.ok) return take;
    kept.push(take.value);
  }
  return ok(kept);
}

/** One take: its preview artifact for the card, then the library through the sink, bytes unchanged. */
async function keepTake(
  sink: GeneratedAssetSink,
  image: GeneratedImage,
  index: number,
  total: number,
  at: TakeContext,
): AsyncResult<KeptTake> {
  const { input, ctx } = at;
  const preview = await ctx.artifacts.put({
    mediaType: image.mediaType,
    data: image.bytes,
    summary: `Generated still ${index + 1} of ${total} for slot ${input.slotId} (${image.width}×${image.height}).`,
  });
  if (!preview.ok) return preview;
  const stored = await sink.put(
    {
      bytes: image.bytes,
      mediaType: image.mediaType,
      fileName: `image-${ctx.callId}-${index + 1}.${imageExtension(image.mediaType)}`,
      projectId: input.projectId,
      provenance: {
        kind: 'generated',
        generation: 'image',
        provider: image.provider,
        model: image.model,
        access: image.access,
        quality: null,
        promptSha256: at.promptSha256,
        voiceId: null,
        providerRef: null,
        c2pa: image.c2pa,
        costUsd: image.costUsd,
        runId: ctx.runId ? idSchema<'AgentRun'>().parse(ctx.runId) : null,
        createdAt: at.now(),
      },
    },
    { signal: ctx.signal },
  );
  if (!stored.ok) return stored;
  return ok({
    assetId: stored.value.assetId,
    width: image.width,
    height: image.height,
    provider: image.provider,
    model: image.model,
    thumbnailArtifactId: preview.value.id,
  });
}

/** The `imageTakes` card: every take, the one placed, and what they cost. */
export function imageTakesCard(output: GenerateForSlotOutput, ctx: Pick<ToolCardContext, 'runId'>) {
  return {
    type: 'imageTakes' as const,
    id: `imageTakes:${output.timelineId}:${output.slotId}`,
    version: 1 as const,
    runId: ctx.runId,
    projectId: output.projectId,
    timelineId: output.timelineId,
    slotId: output.slotId,
    takes: output.assets.map((asset) => ({
      assetId: asset.assetId,
      provider: asset.provider,
      model: asset.model,
      thumbnailArtifactId: asset.thumbnailArtifactId,
    })),
    placed: output.placed,
    spent: { currency: 'USD' as const, micros: Math.round(output.costUsd * 1_000_000) },
  };
}
