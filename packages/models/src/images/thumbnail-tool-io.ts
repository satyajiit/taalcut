// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `images.generateThumbnail` input and output schemas (using plain ULID strings
 * for JSON Schema compatibility) and its idempotency key.
 */
import {
  hallmarkScoreSchema,
  moneySchema,
  PUBLISH_PLATFORMS,
  socialChapterSchema,
  socialMetadataPackSchema,
  THUMBNAIL_ALIGNMENTS,
  THUMBNAIL_ARCHETYPES,
  THUMBNAIL_ASPECTS,
  THUMBNAIL_THEMES,
  ulidSchema,
  type AssetId,
  type AsyncResult,
  type GeneratedAssetSink,
  type SlotId,
  type ThumbnailAspect,
  type TimelineStore,
} from '@taalcut/core';
import { z } from 'zod';
import type { ImageChainDeps } from './image-chain';
import { sha256Hex, type GenerateForSlotInput } from './image-tool-io';
import type { GeneratedImage, ImageFallback } from './image-types';

export const GENERATE_FOR_SLOT_TIMEOUT_MS = 120_000;

export interface ThumbnailStoredStillInput {
  readonly projectId: GenerateForSlotInput['projectId'];
  readonly slotId: SlotId;
  readonly image: GeneratedImage;
  readonly promptSha256: string;
  readonly now: number;
  readonly signal?: AbortSignal;
}

export interface ImageToolDeps extends ImageChainDeps {
  /** Where the takes enter the library (core's port; library implements it). */
  readonly sink: GeneratedAssetSink & {
    readonly storeGeneratedStill?: (input: ThumbnailStoredStillInput) => AsyncResult<{
      readonly assetId: AssetId;
      readonly thumbnailArtifactId?: string;
    }>;
  };
  /** The slot's gap or clip and the canvas's aspect. */
  readonly timelines: Pick<TimelineStore, 'get'>;
  readonly now?: () => number;
  readonly settings?: {
    readonly get: () => { readonly enabled: boolean };
  };
  readonly generator?: {
    readonly generate: (request: {
      readonly prompt: string;
      readonly width: number;
      readonly height: number;
      readonly aspect: ThumbnailAspect;
      readonly count: 1 | 2 | 3 | 4;
      readonly signal?: AbortSignal;
      readonly requiredAccess?: 'subscription';
    }) => AsyncResult<{
      readonly images: readonly GeneratedImage[];
      readonly model?: string;
      readonly fallbacks?: readonly ImageFallback[];
    }>;
  };
}

export const generateThumbnailChannelInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  handle: z.string().trim().min(1).max(40).optional(),
  avatarArtifactId: z.string().min(1).optional(),
  showOnThumbnail: z.boolean().optional(),
});

export const generateThumbnailSocialInput = z.object({
  researchSummary: z.array(z.string().trim().min(1).max(160)).max(6).optional(),
  youtube: z
    .object({
      title: z.string().trim().min(1).max(100).optional(),
      titleAlternates: z.array(z.string().trim().min(1).max(100)).max(4).optional(),
      description: z.string().trim().min(1).max(5000).optional(),
      tags: z.array(z.string().trim().min(1).max(50)).max(35).optional(),
      chapters: z.array(socialChapterSchema).max(25).optional(),
    })
    .optional(),
  instagram: z
    .object({
      hookLine: z.string().trim().min(1).max(140).optional(),
      caption: z.string().trim().min(1).max(2200).optional(),
      hashtags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    })
    .optional(),
  tiktok: z
    .object({
      caption: z.string().trim().min(1).max(2200).optional(),
      seoKeywords: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
      hashtags: z.array(z.string().trim().min(1).max(40)).max(15).optional(),
    })
    .optional(),
});

export const generateThumbnailInput = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline').optional(),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(600)
    .describe('Visual description of the hero thumbnail scene. Never a real person or their likeness.'),
  aspects: z.array(z.enum(THUMBNAIL_ASPECTS)).min(1).max(4).optional(),
  medium: z
    .enum(['photograph', 'illustration', 'graphic', 'mixed'])
    .optional()
    .describe(
      'The imagery medium the brief calls for. Omit to preserve the medium described in prompt; never default every cover to photography.',
    ),
  composition: z
    .enum(['backdrop', 'complete'])
    .optional()
    .describe(
      'Default backdrop keeps exact typography editable. Use complete when the brief explicitly asks for an entirely generated composition including lettering and supplied branding.',
    ),
  archetype: z.enum(THUMBNAIL_ARCHETYPES).optional(),
  theme: z.enum(THUMBNAIL_THEMES).optional(),
  hookText: z.string().trim().min(1).max(48).describe('1–6 word Hallmark display hook on the thumbnail'),
  kickerText: z.string().trim().min(1).max(28).optional(),
  statBadge: z.string().trim().min(1).max(20).optional(),
  durationBadge: z.string().trim().min(1).max(12).optional(),
  textAlign: z.enum(THUMBNAIL_ALIGNMENTS).optional(),
  takes: z.int().min(1).max(4).optional(),
  channel: generateThumbnailChannelInput.optional(),
  social: generateThumbnailSocialInput.optional(),
});
export type GenerateThumbnailInput = z.output<typeof generateThumbnailInput>;

const thumbnailTakeOutputSchema = z.object({
  assetId: ulidSchema('Asset'),
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
  thumbnailArtifactId: z.string().min(1),
});

const thumbnailVariantOutputSchema = z.object({
  composition: z.enum(['backdrop', 'complete']).optional(),
  aspect: z.enum(THUMBNAIL_ASPECTS),
  platform: z.enum(PUBLISH_PLATFORMS),
  archetype: z.enum(THUMBNAIL_ARCHETYPES),
  theme: z.enum(THUMBNAIL_THEMES),
  hookText: z.string().trim().min(1).max(48),
  kickerText: z.string().trim().min(1).max(28).optional(),
  statBadge: z.string().trim().min(1).max(20).optional(),
  durationBadge: z.string().trim().min(1).max(12).optional(),
  textAlign: z.enum(THUMBNAIL_ALIGNMENTS),
  takes: z.array(thumbnailTakeOutputSchema).min(1).max(4),
  selectedAssetId: ulidSchema('Asset'),
  hallmark: hallmarkScoreSchema,
});

const channelProfileOutputSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  handle: z.string().trim().min(1).max(40).optional(),
  avatarArtifactId: z.string().min(1).optional(),
  showOnThumbnail: z.boolean(),
});

const publishPackCardOutputSchema = z.object({
  type: z.literal('publishPack'),
  id: z.string().min(1),
  version: z.literal(1),
  runId: z.string().min(1).optional(),
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline').optional(),
  channel: channelProfileOutputSchema.optional(),
  thumbnails: z.array(thumbnailVariantOutputSchema).min(1).max(4),
  social: socialMetadataPackSchema,
  spent: moneySchema,
});

export const generateThumbnailOutput = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline').optional(),
  channel: channelProfileOutputSchema.optional(),
  thumbnails: z.array(thumbnailVariantOutputSchema).min(1).max(4),
  social: socialMetadataPackSchema,
  costUsd: z.number().nonnegative(),
  fallbacks: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() })).max(8),
  reviewNote: z.string().min(1).max(400).optional(),
  resultCard: publishPackCardOutputSchema,
});
export type GenerateThumbnailOutput = z.output<typeof generateThumbnailOutput>;

export function generateThumbnailKey(input: GenerateThumbnailInput): string {
  return sha256Hex(
    JSON.stringify([
      input.projectId,
      input.timelineId ?? '',
      input.prompt,
      input.medium ?? '',
      input.composition ?? 'backdrop',
      input.aspects ?? ['16:9', '9:16'],
      input.archetype ?? 'editorial-specimen',
      input.theme ?? 'golden-hour',
      input.hookText,
      input.kickerText ?? '',
      input.statBadge ?? '',
      input.durationBadge ?? '',
      input.textAlign ?? 'bottom-left',
      input.takes ?? 1,
      // Schema parsing fixes object key order for callers as well as executor-validated input.
      input.channel ? generateThumbnailChannelInput.parse(input.channel) : null,
      input.social ? generateThumbnailSocialInput.parse(input.social) : null,
    ]),
  );
}
