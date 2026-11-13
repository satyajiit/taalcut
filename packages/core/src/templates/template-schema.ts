// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template v1 (P2-T1): one immutable version of a template, the structure of a
 * reference reel or a format plan. The renderer, library, render and agent all
 * read templates and may not import @taalcut/templates (PRD 6.2), so the type
 * and its invariants are contract; migrations, edits, breakdown and formats stay
 * in @taalcut/templates. Frozen at the end of week 5: a change is version 2.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { frameRateSchema } from '../time/frame-rate';
import { rationalTimeSchema } from '../time/rational-time';
import {
  beatMapSchema,
  canvasSchema,
  contactSheetSchema,
  doubtsSchema,
  FORMAT_IDS,
  languageTagSchema,
  pacingStatsSchema,
  REFERENCE_INPUTS,
  REFERENCE_PLATFORMS,
  sha256Schema,
  templateSlotSchema,
  textOverlaySchema,
} from './template-parts';
import { audioProfileSchema } from './template-audio';
import { templateGraphicsSchema } from './graphic-components';
import { reelSubjectsSchema } from './reel-subjects';
import { checkTemplate } from './template-rules';

export const TEMPLATE_SCHEMA_VERSION = 1;
const time = rationalTimeSchema;

export const templateOriginSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('reference'),
    input: z.enum(REFERENCE_INPUTS),
    platform: z.enum(REFERENCE_PLATFORMS).nullable(),
    /** The pasted link. Stays on this Mac; removed from any export or hub upload (D9). Null for files. */
    url: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable(),
    /** sha256 of the analysed file: finds a repeat paste. */
    fingerprint: sha256Schema,
    source: z.object({
      duration: time,
      rate: frameRateSchema,
      width: z.int().positive(),
      height: z.int().positive(),
    }),
    /** The reel's rectangle inside a screen recording, in source pixels. */
    crop: z
      .object({
        x: z.int().nonnegative(),
        y: z.int().nonnegative(),
        width: z.int().positive(),
        height: z.int().positive(),
      })
      .nullable(),
    pipelineVersion: z.string().min(1).max(32),
    configVersion: z.string().min(1).max(64),
    analysedAt: z.int().nonnegative(),
  }),
  z.object({
    kind: z.literal('format'),
    formatId: z.enum(FORMAT_IDS),
    formatVersion: z.string().min(1).max(32),
    target: time,
    /** The user's words: "a 30 s vlog of my Goa trip". */
    brief: z.string().max(500).nullable(),
  }),
  z.object({ kind: z.literal('manual') }),
]);

const templateObjectSchema = z.object({
  schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
  id: idSchema<'Template'>(),
  /** Content version in the lineage, from 1. Immutable once stored. */
  version: z.int().min(1),
  parentVersion: z.int().min(1).nullable(),
  createdAt: z.int().nonnegative(),
  origin: templateOriginSchema,
  canvas: canvasSchema,
  duration: time,
  slots: z.array(templateSlotSchema).min(1).max(200),
  beatMap: beatMapSchema.nullable(),
  /** The text pattern: on-screen text in time order. */
  text: z.array(textOverlaySchema).max(500),
  audio: audioProfileSchema,
  pacing: pacingStatsSchema,
  /** The look is a Style, applicable to any template or format; never stored here. */
  styleId: idSchema<'Style'>().nullable(),
  contactSheet: contactSheetSchema.nullable(),
  language: languageTagSchema.nullable(),
  /** BRK1: what the review should ask about the whole reel: its tempo, its speech and its sound credit. */
  doubts: doubtsSchema.optional(),
  /** FRM1: where people are in the reel over time, for placing graphics as the reel did (reel-subjects.ts). */
  subjects: reelSubjectsSchema.optional(),
  /** DSG1: the graphics designed for this template and the overlays they draw (graphic-components.ts). */
  graphics: templateGraphicsSchema.optional(),
});

/** One immutable version of a template, its invariants checked (template-rules.ts). */
export const templateSchema = templateObjectSchema.superRefine(checkTemplate);

/** A template at one version: what timelines, cards and renders point at. */
export const templateRefSchema = z.object({ id: idSchema<'Template'>(), version: z.int().min(1) });

export type Template = z.output<typeof templateSchema>;
export type TemplateOrigin = z.output<typeof templateOriginSchema>;
export type TemplateRef = z.output<typeof templateRefSchema>;
