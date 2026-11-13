// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type Id } from '../basics/ids';
import { creationSourceInputSchema, creationVoiceSchema } from '../creation/creation-types';
import { rationalTimeSchema } from '../time/rational-time';
import { videoAspectSchema } from '../timeline/simple-editor';
import { exportPresetIdSchema } from '../render/presets';

export type ProductId = Id<'Product'>;
export type ProductIdeaId = Id<'ProductIdea'>;
export type ProductCampaignId = Id<'ProductCampaign'>;
export function similarProductAngle(left: string, right: string): boolean {
  const words = (text: string) =>
    new Set(
      normalizeProductFeatureKey(text)
        .split(' ')
        .filter((word) => word.length > 2),
    );
  const a = words(left);
  const b = words(right);
  const union = new Set([...a, ...b]).size;
  return (
    union === 0 ||
    [...a].filter((word) => b.has(word)).length / union >= 0.55 ||
    normalizeProductFeatureKey(left) === normalizeProductFeatureKey(right)
  );
}
export function normalizeProductFeatureKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
export const PRODUCT_PLATFORMS = ['youtube', 'instagram', 'x', 'linkedin', 'facebook'] as const;
export const productPlatformSchema = z.enum(PRODUCT_PLATFORMS);
export type ProductPlatform = z.output<typeof productPlatformSchema>;

export const productSourceSchema = creationSourceInputSchema.safeExtend({
  purpose: z.enum(['repository', 'website', 'social', 'reference']).default('repository'),
  liveCapture: z.boolean().default(false),
});
export type ProductSource = z.output<typeof productSourceSchema>;
export const productPreferencesSchema = z.object({
  formats: z.array(videoAspectSchema).min(1).max(4).default(['9:16']),
  duration: rationalTimeSchema
    .refine(
      (time) =>
        time.value * time.rate.den >= 5 * time.rate.num && time.value * time.rate.den <= 179 * time.rate.num,
      'Product duration must be between 5 and 179 seconds',
    )
    .default(() => rationalTimeSchema.parse({ value: 2700, rate: { num: 60, den: 1 } })),
  fps: z.literal(60).default(60),
  resolution: z.literal('4k').default('4k'),
  language: z.string().min(2).max(35).default('en'),
  audience: z.string().max(1000).default(''),
  tone: z.string().max(1000).default(''),
  callToAction: z.string().max(1000).default(''),
  topics: z.array(z.string().trim().min(1).max(200)).default([]),
  instructions: z.string().max(12_000).default(''),
  voice: creationVoiceSchema.default({ mode: 'none', voiceId: null, assetId: null, language: 'en' }),
  budgetCapMicros: z.int().nonnegative().nullable().default(null),
  maxDraftsPerDay: z.int().min(1).max(100).default(1),
  ideaPolicy: z.enum(['approval', 'auto-draft']).default('approval'),
  noveltyDays: z.int().min(1).max(365).default(30),
});
export const productChannelSchema = z.object({
  platform: productPlatformSchema,
  accountId: z.string().min(1).max(500),
  enabled: z.boolean().default(true),
});
export const productInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(12_000).default(''),
  sources: z.array(productSourceSchema).default([]),
  preferences: productPreferencesSchema.default(() => productPreferencesSchema.parse({})),
  channels: z.array(productChannelSchema).default([]),
  styleId: idSchema<'Style'>().nullable().default(null),
});
export type ProductInput = z.output<typeof productInputSchema>;
export const productSchema = productInputSchema.extend({
  id: idSchema<'Product'>(),
  revision: z.int().positive(),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
  archivedAt: z.int().nonnegative().nullable(),
});
export type Product = z.output<typeof productSchema>;

export const productKnowledgeInputSchema = z.object({
  sourceId: idSchema<'CreationSource'>(),
  locator: z.string().min(1).max(4000),
  digest: z.string().min(1).max(200),
  title: z.string().max(500),
  text: z.string().min(1).max(24_000),
  capturedAt: z.int().nonnegative(),
});
export type ProductKnowledgeInput = z.output<typeof productKnowledgeInputSchema>;
export const productKnowledgeSchema = productKnowledgeInputSchema.extend({
  id: idSchema<'ProductKnowledge'>(),
  productId: idSchema<'Product'>(),
});
export type ProductKnowledge = z.output<typeof productKnowledgeSchema>;
export const productEvidenceSchema = z.object({
  knowledgeId: idSchema<'ProductKnowledge'>(),
  sourceId: idSchema<'CreationSource'>(),
  locator: z.string().max(4000),
  digest: z.string().max(200),
  excerpt: z.string().max(2000),
});
export const productIdeaDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  featureKey: z.string().trim().min(1).max(200),
  angle: z.string().trim().min(1).max(1000),
  hook: z.string().trim().min(1).max(1000),
  rationale: z.string().max(4000),
  score: z.number().min(0).max(1),
  knowledgeIds: z.array(idSchema<'ProductKnowledge'>()).min(1).max(20),
});
export type ProductIdeaDraft = z.output<typeof productIdeaDraftSchema>;
export const productIdeaSchema = productIdeaDraftSchema.omit({ knowledgeIds: true }).extend({
  id: idSchema<'ProductIdea'>(),
  productId: idSchema<'Product'>(),
  evidence: z.array(productEvidenceSchema).min(1).max(20),
  status: z.enum(['suggested', 'rejected', 'chosen']),
  feedback: z.string().max(2000).nullable(),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});
export type ProductIdea = z.output<typeof productIdeaSchema>;
export const productCampaignSchema = z.object({
  id: idSchema<'ProductCampaign'>(),
  productId: idSchema<'Product'>(),
  ideaId: idSchema<'ProductIdea'>(),
  projectId: idSchema<'Project'>(),
  conversationId: idSchema<'Conversation'>().nullable(),
  renders: z
    .array(
      z.object({
        renderId: idSchema<'Render'>(),
        timelineId: idSchema<'Timeline'>(),
        timelineRevision: z.int().positive(),
        presetId: exportPresetIdSchema,
      }),
    )
    .max(8)
    .optional(),
  revision: z.int().positive(),
  status: z.enum(['draft', 'ready', 'approved', 'scheduled', 'published', 'failed']),
  attempts: z.int().nonnegative().optional(),
  retryAt: z.int().nonnegative().nullable().optional(),
  lastError: z.string().nullable().optional(),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});
export type ProductCampaign = z.output<typeof productCampaignSchema>;
