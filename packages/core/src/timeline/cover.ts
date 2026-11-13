// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { ulidSchema } from '../basics/ids';
import { coverDesignSchema } from './cover-design';
import {
  THUMBNAIL_ASPECTS,
  THUMBNAIL_ARCHETYPES,
  THUMBNAIL_THEMES,
  THUMBNAIL_ALIGNMENTS,
} from '../cards/publish-pack-card';

/** Durable cover choices shared by the editor and publishing studio. Frame indexes use the video's rate. */
export const coverSettingsSchema = z
  .object({
    aspect: z.enum(THUMBNAIL_ASPECTS),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('frame'), frame: z.int().nonnegative() }),
      z.object({ kind: z.literal('asset'), assetId: ulidSchema('Asset') }),
      z.object({ kind: z.literal('solid') }),
    ]),
    archetype: z.enum(THUMBNAIL_ARCHETYPES).default('minimal-frame'),
    theme: z.enum(THUMBNAIL_THEMES).default('golden-hour'),
    textAlign: z.enum(THUMBNAIL_ALIGNMENTS).default('bottom-left'),
    hookText: z.string().max(48).default(''),
    kickerText: z.string().max(28).default(''),
    statBadge: z.string().max(20).default(''),
    channel: z.object({ name: z.string().max(60), handle: z.string().max(40), show: z.boolean() }).optional(),
    /** Authored text and graphics replace preset overlays; coordinates are relative to the canvas. */
    design: coverDesignSchema.optional(),
  })
  .refine(
    (cover) => cover.source.kind !== 'solid' || cover.design !== undefined,
    'A solid cover needs a design',
  );
export type CoverSettings = z.output<typeof coverSettingsSchema>;
export const coverTargetSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
});
export const setCoverPayloadSchema = coverTargetSchema.extend({ cover: coverSettingsSchema });
/** A draft preview reads only. Omitting cover reads the last saved design. */
export const coverExportPayloadSchema = coverTargetSchema.extend({
  aspect: z.enum(THUMBNAIL_ASPECTS).optional(),
});
export const coverImageInputSchema = coverExportPayloadSchema.extend({
  cover: coverSettingsSchema.optional(),
});
export const coverImageSchema = z.object({
  mimeType: z.literal('image/jpeg'),
  dataBase64: z.string().max(11_184_812),
  width: z.int().positive(),
  height: z.int().positive(),
  revision: z.int().positive(),
});
export type CoverImageInput = z.input<typeof coverImageInputSchema>;
export type CoverImage = z.output<typeof coverImageSchema>;

export const coverExportResultSchema = z.object({
  assetId: ulidSchema('Asset').optional(),
  fileName: z.string().min(1).max(255),
  width: z.int().positive(),
  height: z.int().positive(),
  revision: z.int().positive(),
});
