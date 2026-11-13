// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Thumbnail and social publishing pack card: multi-aspect Hallmark-validated
 * video thumbnails (16:9 YouTube, 9:16 Shorts/Reels/TikTok, 4:5 and 1:1 IG
 * feed/grid) with optional channel branding and researched copy-and-paste
 * metadata for YouTube, Instagram and TikTok.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { moneySchema } from '../basics/money';
import { base, runId } from './card-parts';

export const THUMBNAIL_ASPECTS = ['16:9', '9:16', '4:5', '1:1'] as const;
export type ThumbnailAspect = (typeof THUMBNAIL_ASPECTS)[number];

export const PUBLISH_PLATFORMS = ['youtube', 'shorts', 'reels', 'tiktok'] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

export const THUMBNAIL_ARCHETYPES = [
  'editorial-specimen',
  'brutal-slab',
  'atmospheric-cinema',
  'minimal-frame',
  'stat-callout',
] as const;
export type ThumbnailArchetype = (typeof THUMBNAIL_ARCHETYPES)[number];

export const THUMBNAIL_THEMES = [
  'golden-hour',
  'midnight',
  'newsprint',
  'studio',
  'terminal',
  'brand-kit',
] as const;
export type ThumbnailTheme = (typeof THUMBNAIL_THEMES)[number];

export const THUMBNAIL_ALIGNMENTS = ['left', 'top-left', 'bottom-left'] as const;
export type ThumbnailAlignment = (typeof THUMBNAIL_ALIGNMENTS)[number];

/** Hallmark 6-axis pre-emit self-critique score (each axis 1..5, passes when all >= 4 and total >= 26). */
export const hallmarkScoreSchema = z.object({
  philosophy: z.int().min(1).max(5),
  hierarchy: z.int().min(1).max(5),
  execution: z.int().min(1).max(5),
  specificity: z.int().min(1).max(5),
  restraint: z.int().min(1).max(5),
  variety: z.int().min(1).max(5),
  passed: z.boolean(),
});
export type HallmarkScore = z.output<typeof hallmarkScoreSchema>;

/** Optional creator channel identity shown on the thumbnail badge and platform feed preview. */
export const channelProfileSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  handle: z.string().trim().min(1).max(40).optional(),
  avatarArtifactId: z.string().min(1).optional(),
  showOnThumbnail: z.boolean(),
});
export type ChannelProfile = z.output<typeof channelProfileSchema>;

export const thumbnailTakeSchema = z.object({
  assetId: idSchema<'Asset'>(),
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
  thumbnailArtifactId: z.string().min(1),
});
export type ThumbnailTake = z.output<typeof thumbnailTakeSchema>;

export const thumbnailVariantSchema = z.object({
  aspect: z.enum(THUMBNAIL_ASPECTS),
  /** Complete imagery already contains the requested type/graphics; never add duplicate preset text. */
  composition: z.enum(['backdrop', 'complete']).optional(),
  platform: z.enum(PUBLISH_PLATFORMS),
  archetype: z.enum(THUMBNAIL_ARCHETYPES),
  theme: z.enum(THUMBNAIL_THEMES),
  hookText: z.string().trim().min(1).max(48),
  kickerText: z.string().trim().min(1).max(28).optional(),
  statBadge: z.string().trim().min(1).max(20).optional(),
  durationBadge: z.string().trim().min(1).max(12).optional(),
  textAlign: z.enum(THUMBNAIL_ALIGNMENTS),
  takes: z.array(thumbnailTakeSchema).min(1).max(4),
  selectedAssetId: idSchema<'Asset'>(),
  hallmark: hallmarkScoreSchema,
});
export type ThumbnailVariant = z.output<typeof thumbnailVariantSchema>;

export const socialChapterSchema = z.object({
  timecode: z.string().trim().min(4).max(12),
  label: z.string().trim().min(1).max(80),
});
export type SocialChapter = z.output<typeof socialChapterSchema>;

export const socialMetadataPackSchema = z.object({
  x: z.object({ text: z.string().max(25_000) }).optional(),
  linkedin: z.object({ text: z.string().max(3000) }).optional(),
  facebook: z.object({ title: z.string().max(500), description: z.string().max(63_206) }).optional(),
  researchSummary: z.array(z.string().trim().min(1).max(160)).max(6),
  youtube: z.object({
    title: z.string().trim().min(1).max(100),
    titleAlternates: z.array(z.string().trim().min(1).max(100)).max(4),
    description: z.string().trim().min(1).max(5000),
    tags: z.array(z.string().trim().min(1).max(50)).min(1).max(35),
    chapters: z.array(socialChapterSchema).max(25),
  }),
  instagram: z.object({
    hookLine: z.string().trim().min(1).max(140),
    caption: z.string().trim().min(1).max(2200),
    hashtags: z.array(z.string().trim().min(1).max(40)).max(20),
  }),
  tiktok: z.object({
    caption: z.string().trim().min(1).max(2200),
    seoKeywords: z.array(z.string().trim().min(1).max(40)).max(12),
    hashtags: z.array(z.string().trim().min(1).max(40)).max(15),
  }),
});
export type SocialMetadataPack = z.output<typeof socialMetadataPackSchema>;

export const publishPackCardSchema = z.object({
  type: z.literal('publishPack'),
  ...base,
  runId: runId.optional(),
  projectId: idSchema<'Project'>(),
  timelineId: idSchema<'Timeline'>().optional(),
  /** Exact finished-video frame; independent of generated thumbnail evaluations. */
  coverAssetId: idSchema<'Asset'>().optional(),
  channel: channelProfileSchema.optional(),
  thumbnails: z.array(thumbnailVariantSchema).max(4),
  social: socialMetadataPackSchema,
  spent: moneySchema,
});
export type PublishPackCard = z.output<typeof publishPackCardSchema>;
