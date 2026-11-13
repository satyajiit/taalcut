// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Casting (P2-M2): which shot fills each template slot, its scored
 * alternates and why. Stored on the Timeline (`timeline.cast`) and shown by
 * the cast board, which reads it through `timelines.watch`.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { rationalTimeSchema } from '../time/rational-time';

export const castCandidateSchema = z.object({
  assetId: idSchema<'Asset'>(),
  /** Null for a photo. */
  shotId: idSchema<'Shot'>().nullable(),
  sourceStart: rationalTimeSchema,
  syncPoint: rationalTimeSchema.nullable(),
  score: z.number(),
  parts: z.object({
    intent: z.number(),
    motion: z.number(),
    quality: z.number(),
    subject: z.number(),
    energy: z.number(),
    hook: z.number().nullable(),
    rerank: z.number().nullable(),
    penalty: z.number(),
  }),
});
export type CastCandidate = z.output<typeof castCandidateSchema>;

/**
 * Why a slot's pick is as it is. P3: `gapFilled` (a gap fix put media in), `dropped` (the slot was dropped),
 * `filmRequested` (the person will film it: on the phone's shot list).
 */
export const CAST_NOTES = [
  'noCandidates',
  'orientationRelaxed',
  'reranked',
  'userPick',
  'gapFilled',
  'dropped',
  'filmRequested',
] as const;
export type CastNote = (typeof CAST_NOTES)[number];
export const CAST_MODES = ['template', 'story'] as const;

export const slotCastSchema = z.object({
  slotId: idSchema<'TemplateSlot'>(),
  /** The clip filling the slot; null when it is a gap. */
  clipId: idSchema<'TimelineItem'>().nullable(),
  pick: castCandidateSchema.nullable(),
  alternates: z.array(castCandidateSchema).max(3),
  confidence: z.number().min(0).max(1).nullable(),
  needsRerank: z.boolean(),
  note: z.enum(CAST_NOTES).nullable(),
});
export type SlotCast = z.output<typeof slotCastSchema>;

export const castStateSchema = z.object({
  castId: idSchema<'Cast'>(),
  mode: z.enum(CAST_MODES),
  variantIndex: z.int().min(0).max(9),
  variantCount: z.int().min(1).max(10),
  configVersion: z.string().min(1).max(64),
  sequenceConfidence: z.number().min(0).max(1),
  slots: z.array(slotCastSchema).max(200),
});
export type CastState = z.output<typeof castStateSchema>;
