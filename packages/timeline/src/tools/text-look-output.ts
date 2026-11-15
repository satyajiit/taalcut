// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: what `timeline.textLook` and `timeline.placeText` answer (text-look-read.ts and text-group-facts.ts build
 * it). Facts for whoever designs and places the text; no field here is a rule.
 */
import { textLookSchema, ulidSchema } from '@taalcut/core';
import { z } from 'zod';

const faceSchema = z.object({
  id: z.string(),
  family: z.string(),
  class: z.string(),
  weights: z.tuple([z.number(), z.number()]),
});

const reelSchema = z.object({
  measured: z.int(),
  of: z.int(),
  /** 0: the outline, shadow and width were never measured (unknown, not none). */
  lettersMeasured: z.int(),
  colour: z.string(),
  weight: z.int(),
  class: z.string(),
  outline: z.object({ colour: z.string().nullable(), widthPx: z.int() }).nullable(),
  shadow: z.boolean().nullable(),
  width: z.string().nullable(),
  spacing: z.number().nullable(),
  box: z.object({ colour: z.string() }).nullable(),
  case: z.string(),
  arrives: z.string(),
  confidence: z.number(),
});

const placeSchema = z.object({
  x: z.number(),
  y: z.number(),
  align: z.string(),
  size: z.number(),
  capPx: z.int(),
});

/** One group of texts: where it sits, how large, what is under it, where the reference had it. */
export const textGroupSchema = placeSchema.extend({
  group: z.string(),
  role: z.string(),
  texts: z.int(),
  run: z.boolean(),
  example: z.string(),
  fromSeconds: z.number(),
  toSeconds: z.number(),
  placedBy: z.enum(['nobody', 'ai', 'person']),
  /** The lines each text draws on, in the order they show; the stated wrap width; a line wider than the frame. */
  lines: z.array(z.int()),
  wrapAt: z.number().nullable(),
  widerThanFrame: z.boolean(),
  atFrameEdge: z.boolean(),
  under: z.object({ face: z.number(), person: z.number(), frames: z.int() }).nullable(),
  coveredBy: z.array(z.string()),
  reel: placeSchema.nullable(),
  candidate: placeSchema.extend({ clear: z.boolean(), faceUnder: z.number().optional() }).nullable(),
});

const areaSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

export const placeTextOutputSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  affectedItemIds: z.array(z.string()),
  /** The groups stated, as they now stand. */
  groups: z.array(textGroupSchema),
  /** The groups nobody has placed yet. */
  unplaced: z.array(z.string()),
  system: z.string(),
  reading: z.string(),
  platformsNote: z.string(),
});

export const textLookOutputSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  style: z.object({ id: ulidSchema('Style'), name: z.string() }).nullable(),
  roles: z.array(
    z.object({
      role: z.string(),
      texts: z.int(),
      example: z.string(),
      itemIds: z.array(z.string()),
      look: textLookSchema.nullable(),
      reel: reelSchema.nullable(),
    }),
  ),
  /** The roles whose texts would be drawn in the default face: each needs a look before the video is done. */
  undesigned: z.array(z.string()),
  faces: z.array(faceSchema),
  groups: z.array(textGroupSchema),
  /** The groups nobody has placed yet: each needs a stated place before the video is done. */
  unplaced: z.array(z.string()),
  system: z.string(),
  reading: z.string(),
  /**
   * The part of the frame each platform's own interface leaves clear, as shares of the frame; null for a video
   * that is not 9:16. Provisional: never matched to the apps.
   */
  platforms: z
    .object({ provisional: z.literal(true), shorts: areaSchema, reels: areaSchema, tiktok: areaSchema })
    .nullable(),
});
