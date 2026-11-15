// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { ulidSchema } from '../basics/ids';
import { compositionGateCheckSchema } from '../workspace/composition';
import { COVER_MEDIUMS, coverCompositionSchema, coverOptionsSchema } from './cover-composition';
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
    /**
     * CVR2: the cover as a HyperFrames composition over real frames (cover-composition.ts). It draws the whole
     * cover: `source` then only names its lead picture, and the preset overlays and `design` are not drawn.
     */
    composition: coverCompositionSchema.optional(),
    /** CVR2: the designs offered for this cover; `composition` is the one in use. */
    options: coverOptionsSchema.optional(),
    /** CVR2: what the picture is made of, as the model understood the request. Absent on a hand-made cover. */
    medium: z.enum(COVER_MEDIUMS).optional(),
  })
  .refine(
    (cover) => cover.source.kind !== 'solid' || cover.design !== undefined || cover.composition !== undefined,
    'A solid cover needs a design',
  )
  .refine(
    (cover) => cover.composition === undefined || cover.design === undefined,
    'A cover is drawn by its composition or by its design, not both',
  )
  .refine(
    (cover) =>
      cover.options === undefined ||
      (cover.composition !== undefined &&
        cover.options.designs.some((design) => design.hash === cover.composition?.hash)),
    'The design in use is one of the designs offered',
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
  /**
   * CVR2: for a composition cover, what the drawn cover says of itself (render's cover checks: its words on the
   * canvas, their size, the headline in the crop-safe area, its pictures, its drawn marks), each with what to
   * change. Absent for a cover drawn any other way.
   */
  checks: z.array(compositionGateCheckSchema).max(16).optional(),
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

/** CVR1: the longest note a cover request carries: one line of the user's own words. */
export const COVER_NOTE_MAX = 200;
/**
 * CVR1: a cover asked for in the editor's cover panel ("Generate with AI"): the aspect picked there and, when the
 * user wrote one, what the cover should show or say. It travels on the chat message (`messageExtrasShape.cover`),
 * so the aspect the AI owes is data and is never read out of the message's words.
 */
export const coverRequestSchema = z.object({
  aspect: z.enum(THUMBNAIL_ASPECTS),
  note: z.string().trim().min(1).max(COVER_NOTE_MAX).optional(),
});
export type CoverRequest = z.output<typeof coverRequestSchema>;
