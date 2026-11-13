// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A look measured from a reference or a clip (P3-V17, vision SPEC P3.2): colour statistics a grade is baked
 * towards, and the curated font that best matches the reference's on-screen text. Both join the Style
 * (`style.grade`, `style.fontMatch`); vision measures and bakes them through the job kinds in look-jobs.ts.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/id-schema';
import { CAPTION_FONTS, isCaptionFont } from '../render/captions';
import { timeRangeSchema } from '../time/time-range';

const triple = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

/** Reinhard's statistics: pooled mean and standard deviation per Ruderman lαβ axis. */
export const lookStatsSchema = z.object({
  version: z.literal(1),
  space: z.literal('ruderman-lab'),
  encoding: z.enum(['bt709', 'bt2020']),
  mean: triple,
  std: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  frames: z.int().min(1).max(64),
  pixels: z.int().positive(),
});
export type LookStats = z.output<typeof lookStatsSchema>;

export const LUT_CUBE_SIZES = [17, 33] as const;
/** A LUT's cube edge: 17 for previews, 33 for exports. */
export const lutCubeSizeSchema = z.literal(LUT_CUBE_SIZES);

/** A grade towards a measured look, baked into a LUT per clip by vision. */
export const styleGradeSchema = z.object({
  version: z.literal(1),
  target: lookStatsSchema,
  strength: z.number().min(0).max(1),
  cubeSize: lutCubeSizeSchema,
  /** Where the look was measured: a template version's reference frames, or a library clip. */
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('template'), templateId: idSchema<'Template'>(), version: z.int().min(1) }),
    z.object({ kind: z.literal('asset'), assetId: idSchema<'Asset'>(), range: timeRangeSchema }),
  ]),
  measuredAt: z.int().nonnegative(),
});
export type StyleGrade = z.output<typeof styleGradeSchema>;

export const FONT_MATCH_SCRIPTS = ['latin', 'devanagari'] as const;

/**
 * Round P3-3 (media C-26): the faces vision matches a reference's text against besides the caption fonts. Vision
 * bundles them for matching (packages/vision/fonts); render has no file for them yet, so captions never draw
 * one. A face moves into CAPTION_FONTS when render bundles it (fonts.lock.json, coverage, category).
 */
export const MATCH_ONLY_FONTS = [
  'inter',
  'sourceSans3',
  'sourceSerif4',
  'lora',
  'merriweather',
  'libreFranklin',
  'nunito',
  'ibmPlexSans',
  'tiroDevanagariHindi',
  'martel',
  'kalam',
] as const;
/** Every face a font match may name: the caption fonts, then the match-only faces. */
export const FONT_MATCH_FAMILIES = [...CAPTION_FONTS, ...MATCH_ONLY_FONTS] as const;
export type FontMatchFamily = (typeof FONT_MATCH_FAMILIES)[number];

const ssim = z.number().min(-1).max(1);

/**
 * A match stored before round P3-3 has no `captionFont`: its `family` was always a caption font, and is it. An
 * input-side step, so the schema still converts to JSON Schema for a tool's output.
 */
function withCaptionFont(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || 'captionFont' in value || !('family' in value))
    return value;
  return { ...value, captionFont: value.family };
}

/** The face closest to a reference's text, by SSIM over rendered samples, and the caption font captions use. */
export const fontMatchSchema = z.preprocess(
  withCaptionFont,
  z
    .object({
      version: z.literal(1),
      /** The best face of any vision matches against (round P3-3; a caption font before). */
      family: z.enum(FONT_MATCH_FAMILIES),
      /** What captions draw: `family` itself when it is a caption font, else the best-ranked caption font. */
      captionFont: z.enum(CAPTION_FONTS),
      /** Mean SSIM of `family`, raw (−1…1). */
      score: ssim,
      metric: z.literal('ssim'),
      script: z.enum(FONT_MATCH_SCRIPTS),
      /** The top faces, best first, of every family (round P3-3; caption fonts only before). */
      ranking: z.array(z.object({ family: z.enum(FONT_MATCH_FAMILIES), score: ssim })).max(5),
      /** The OCR'd words the match used: untrusted, for display only. */
      sampleText: z.string().max(80),
      ocrConfidence: z.number().min(0).max(1),
    })
    .refine((match) => !isCaptionFont(match.family) || match.captionFont === match.family, {
      message: 'A family render can draw is the caption font',
      path: ['captionFont'],
    }),
);
export type FontMatch = z.output<typeof fontMatchSchema>;
