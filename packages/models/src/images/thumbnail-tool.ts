// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `images.generateThumbnail`: generates thumbnail backdrops with Hallmark design guidance across
 * requested aspect ratios (`16:9` YouTube, `9:16` Shorts/Reels/TikTok, `4:5` and
 * `1:1` IG feed/grid) without requiring a template slot, stores every take in the
 * library through `GeneratedAssetSink`, synthesizes researched YouTube, Instagram,
 * and TikTok publishing metadata, and emits a `publishPack` smart card.
 */
import {
  defineTool,
  err,
  idSchema,
  NO_TOOL_RETRY,
  ok,
  publishPackCardSchema,
  type AssetId,
  type AsyncResult,
  type ChannelProfile,
  type PublishPackCard,
  type SlotId,
  type ThumbnailAspect,
  type ThumbnailTake,
  type ThumbnailVariant,
  type ToolContextBase,
} from '@taalcut/core';
import { ImageAccessDenied, ImageNoProvider } from '../errors';
import { imageExtension } from './image-bytes';
import { generateImages } from './image-chain';
import { sha256Hex } from './image-tool-io';
import { estimateThumbnailCost, refineThumbnailCost, uniqueAspects } from './thumbnail-cost';
import type { GeneratedImage, ImageFallback } from './image-types';
import { buildSocialMetadataPack } from './social-metadata';
import {
  buildHallmarkThumbnailPrompt,
  evaluateHallmarkThumbnail,
  HALLMARK_THUMBNAIL_REVIEW_NOTE,
  THUMBNAIL_ASPECT_SPECS,
} from './thumbnail-hallmark';
import {
  GENERATE_FOR_SLOT_TIMEOUT_MS,
  generateThumbnailChannelInput,
  generateThumbnailInput,
  generateThumbnailKey,
  generateThumbnailOutput,
  generateThumbnailSocialInput,
  type GenerateThumbnailInput,
  type GenerateThumbnailOutput,
  type ImageToolDeps,
} from './thumbnail-tool-io';

export {
  generateThumbnailChannelInput,
  generateThumbnailInput,
  generateThumbnailKey,
  generateThumbnailOutput,
  generateThumbnailSocialInput,
  type GenerateThumbnailInput,
  type GenerateThumbnailOutput,
};

export const ImageGenerationOff = () => ImageNoProvider();

export function createGenerateThumbnailTool(deps: ImageToolDeps) {
  const now = deps.now ?? Date.now;
  return defineTool({
    name: 'images.generateThumbnail',
    version: '1.1.0',
    description:
      'Generates photography, illustration, graphics or mixed artwork following the brief and Hallmark guidance (16:9 YouTube, 9:16 Shorts/Reels/TikTok, ' +
      '4:5 and 1:1 Instagram feed/grid), with editable typography, optional channel branding, and a ' +
      'YouTube, Instagram, and TikTok social publishing metadata pack (titles, descriptions, chapters, comma-separated ' +
      'tags, captions, and SEO keywords). Uses an available image provider, including supported ChatGPT/Grok subscriptions. Default backdrop mode leaves typography editable; complete mode includes requested lettering and supplied branding. For local graphic covers or footage, ' +
      'use timeline.setCover and render.exportCover instead; they need no image provider. This tool checks the written ' +
      'brief, not rendered visual quality: inspect the final composition, then save it with those cover tools before ' +
      'claiming a finished thumbnail. Never depicts a real person or their likeness.',
    summary: 'Generates thumbnail artwork and publishing copy for design review.',
    tags: [
      'image',
      'thumbnail',
      'cover',
      'youtube',
      'shorts',
      'reels',
      'tiktok',
      'instagram',
      'publish',
      'hallmark',
    ],
    input: generateThumbnailInput,
    output: generateThumbnailOutput,
    costClass: 'paid',
    sideEffect: 'read',
    timeoutMs: GENERATE_FOR_SLOT_TIMEOUT_MS,
    retry: NO_TOOL_RETRY,
    permission: { network: 'internet', cloudModules: ['images'] },
    idempotencyKey: generateThumbnailKey,
    estimateCost: (input) => estimateThumbnailCost(deps, input),
    refineCost: (input, ctx) => refineThumbnailCost(deps, input, ctx.signal),
    async run(input, ctx) {
      if (deps.settings && !deps.settings.get().enabled) {
        return err(ImageGenerationOff());
      }
      const aspects = uniqueAspects(input.aspects);
      const archetype = input.archetype ?? 'editorial-specimen';
      const theme = input.theme ?? 'golden-hour';
      const textAlign = input.textAlign ?? 'bottom-left';
      const count = (input.takes ?? 1) as 1 | 2 | 3 | 4;

      let requiredAccess = ctx.estimate?.billing === 'subscription' ? ('subscription' as const) : undefined;
      const variants: ThumbnailVariant[] = [];
      const fallbacks: { from: string; to: string; reason: string }[] = [];
      let totalCostUsd = 0;

      for (const aspect of aspects) {
        const spec = THUMBNAIL_ASPECT_SPECS[aspect];
        const enhancedPrompt = buildHallmarkThumbnailPrompt({
          prompt: input.prompt,
          medium: input.medium,
          composition: input.composition,
          hookText: input.hookText,
          kickerText: input.kickerText,
          branding:
            input.channel?.showOnThumbnail === false
              ? undefined
              : [input.channel?.name, input.channel?.handle].filter(Boolean).join(' · '),
          aspect,
          archetype,
          theme,
          textAlign,
        });

        const made = await runAspectGeneration(deps, {
          prompt: enhancedPrompt,
          aspect,
          width: spec.width,
          height: spec.height,
          count,
          projectId: input.projectId,
          requiredAccess,
          ctx,
        });
        if (!made.ok) return made;
        if (made.value.images.some((image) => image.access === 'subscription'))
          requiredAccess = 'subscription';

        for (const fb of made.value.fallbacks) {
          if (fallbacks.length < 8) {
            fallbacks.push({
              from: `${fb.from.provider}/${fb.from.model}`,
              to: `${fb.to.provider}/${fb.to.model}`,
              reason: fb.reason.code,
            });
          }
        }

        const promptSha256 = sha256Hex(enhancedPrompt);
        const takes: ThumbnailTake[] = [];
        for (const [index, image] of made.value.images.entries()) {
          totalCostUsd += image.costUsd;
          const storedTake = await storeThumbnailTake(deps, image, {
            projectId: input.projectId,
            aspect,
            index,
            total: made.value.images.length,
            promptSha256,
            now,
            ctx,
          });
          if (!storedTake.ok) return storedTake;
          takes.push(storedTake.value);
        }

        const evaluation = evaluateHallmarkThumbnail({
          prompt: input.prompt,
          hookText: input.hookText,
          kickerText: input.kickerText,
          statBadge: input.statBadge,
          durationBadge: input.durationBadge,
          aspect,
          archetype,
          theme,
          textAlign,
        });

        variants.push({
          ...(input.composition ? { composition: input.composition } : {}),
          aspect,
          platform: spec.platform,
          archetype,
          theme,
          hookText: input.composition === 'complete' ? input.hookText : evaluation.hookText,
          ...(evaluation.kickerText ? { kickerText: evaluation.kickerText } : {}),
          ...(evaluation.statBadge ? { statBadge: evaluation.statBadge } : {}),
          ...(evaluation.durationBadge ? { durationBadge: evaluation.durationBadge } : {}),
          textAlign,
          takes,
          selectedAssetId: takes[0]!.assetId,
          hallmark: evaluation.score,
        });
      }

      const firstVariant = variants[0]!;
      const social = buildSocialMetadataPack({
        prompt: input.prompt,
        hookText: firstVariant.hookText,
        kickerText: firstVariant.kickerText,
        statBadge: firstVariant.statBadge,
        durationBadge: firstVariant.durationBadge,
        archetype,
        theme,
        channel: input.channel,
        social: input.social,
      });

      const channel: ChannelProfile | undefined = input.channel
        ? {
            ...(input.channel.name ? { name: input.channel.name } : {}),
            ...(input.channel.handle ? { handle: input.channel.handle } : {}),
            ...(input.channel.avatarArtifactId ? { avatarArtifactId: input.channel.avatarArtifactId } : {}),
            showOnThumbnail:
              input.channel.showOnThumbnail ?? Boolean(input.channel.name || input.channel.handle),
          }
        : undefined;

      const card: PublishPackCard = publishPackCardSchema.parse({
        type: 'publishPack',
        id: `publishPack:${input.timelineId ?? input.projectId}:${ctx.callId}`,
        version: 1,
        ...(ctx.runId ? { runId: ctx.runId } : {}),
        projectId: input.projectId,
        ...(input.timelineId ? { timelineId: input.timelineId } : {}),
        ...(channel ? { channel } : {}),
        thumbnails: variants,
        social,
        spent: { currency: 'USD', micros: Math.round(totalCostUsd * 1_000_000) },
      });

      return ok({
        projectId: input.projectId,
        ...(input.timelineId ? { timelineId: input.timelineId } : {}),
        ...(channel ? { channel } : {}),
        thumbnails: variants,
        social,
        costUsd: totalCostUsd,
        fallbacks,
        reviewNote: HALLMARK_THUMBNAIL_REVIEW_NOTE,
        resultCard: card,
      });
    },
    async resultCard(output, ctx) {
      return ok(
        publishPackCardSchema.parse({
          ...output.resultCard,
          ...(ctx.runId ? { runId: ctx.runId } : {}),
        }),
      );
    },
  });
}

async function runAspectGeneration(
  deps: ImageToolDeps,
  req: {
    readonly prompt: string;
    readonly aspect: ThumbnailAspect;
    readonly width: number;
    readonly height: number;
    readonly count: 1 | 2 | 3 | 4;
    readonly requiredAccess?: 'subscription';
    readonly projectId: GenerateThumbnailInput['projectId'];
    readonly ctx: ToolContextBase;
  },
): AsyncResult<{ readonly images: readonly GeneratedImage[]; readonly fallbacks: readonly ImageFallback[] }> {
  if (deps.generator) {
    const generated = await deps.generator.generate({
      prompt: req.prompt,
      width: req.width,
      height: req.height,
      aspect: req.aspect,
      count: req.count,
      signal: req.ctx.signal,
      requiredAccess: req.requiredAccess,
    });
    if (!generated.ok) return generated;
    if (req.requiredAccess && generated.value.images.some((image) => image.access !== req.requiredAccess))
      return err(ImageAccessDenied({ provider: generated.value.images[0]?.provider ?? 'images' }));
    for (const img of generated.value.images) {
      req.ctx.reportUsage?.({ usd: img.costUsd, provider: img.provider, model: img.model });
    }
    return ok({ images: generated.value.images, fallbacks: generated.value.fallbacks ?? [] });
  }
  return generateImages(deps, {
    prompt: req.prompt,
    aspect: req.aspect,
    size: 'final',
    requiredAccess: req.requiredAccess,
    count: req.count,
    signal: req.ctx.signal,
    onCharge: (charge) => req.ctx.reportUsage(charge),
    trace: {
      spanId: req.ctx.callId,
      projectId: req.projectId,
      ...(req.ctx.runId ? { runId: req.ctx.runId } : {}),
    },
  });
}

async function storeThumbnailTake(
  deps: ImageToolDeps,
  image: GeneratedImage,
  at: {
    readonly projectId: GenerateThumbnailInput['projectId'];
    readonly aspect: ThumbnailAspect;
    readonly index: number;
    readonly total: number;
    readonly promptSha256: string;
    readonly now: () => number;
    readonly ctx: ToolContextBase;
  },
): AsyncResult<ThumbnailTake> {
  const slotId = `thumbnail:${at.aspect}` as SlotId;
  if (deps.sink.storeGeneratedStill) {
    const stored = await deps.sink.storeGeneratedStill({
      projectId: at.projectId,
      slotId,
      image,
      promptSha256: at.promptSha256,
      now: at.now(),
      signal: at.ctx.signal,
    });
    if (!stored.ok) return stored;
    return ok({
      assetId: stored.value.assetId,
      provider: image.provider,
      model: image.model,
      thumbnailArtifactId:
        stored.value.thumbnailArtifactId ?? `thumb:${at.aspect}:${at.ctx.callId}:${at.index + 1}`,
    });
  }

  let thumbnailArtifactId = `thumb:${at.aspect}:${at.ctx.callId}:${at.index + 1}`;
  if (at.ctx.artifacts?.put) {
    const preview = await at.ctx.artifacts.put({
      mediaType: image.mediaType,
      data: image.bytes,
      summary: `Generated ${at.aspect} thumbnail ${at.index + 1} of ${at.total} (${image.width}×${image.height}).`,
    });
    if (!preview.ok) return preview;
    thumbnailArtifactId = preview.value.id;
  }

  const stored = await deps.sink.put(
    {
      bytes: image.bytes,
      mediaType: image.mediaType,
      fileName: `thumbnail-${at.aspect.replace(':', 'x')}-${at.ctx.callId}-${at.index + 1}.${imageExtension(image.mediaType)}`,
      projectId: at.projectId,
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
        runId: at.ctx.runId ? idSchema<'AgentRun'>().parse(at.ctx.runId) : null,
        createdAt: at.now(),
      },
    },
    { signal: at.ctx.signal },
  );
  if (!stored.ok) return stored;
  return ok({
    assetId: stored.value.assetId as AssetId,
    provider: image.provider,
    model: image.model,
    thumbnailArtifactId,
  });
}
