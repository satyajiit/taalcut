// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Captions (P2-M5): a timeline's caption track, built from the transcript and
 * burned into renders. Part of the Timeline document (`timeline.captions`);
 * edited with the CAPTION_COMMANDS in render-commands.ts.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/id-schema';
import { timeRangeSchema } from '../time/time-range';
import { languageTagSchema } from '../templates/template-parts';

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/);

/** Curated, bundled (OFL). Every stack falls back to Noto Sans, Noto Sans Devanagari, Noto Color Emoji. */
export const CAPTION_FONTS = [
  'notoSans',
  'notoSansDevanagari',
  'poppins',
  'mukta',
  'hind',
  'baloo2',
  'montserrat',
  'anton',
  'bebasNeue',
] as const;
export type CaptionFontId = (typeof CAPTION_FONTS)[number];
const CAPTION_FONT_IDS: ReadonlySet<string> = new Set(CAPTION_FONTS);
/** True for a face render can draw (round P3-3: font matches may name faces render hasn't bundled). */
export const isCaptionFont = (family: string): family is CaptionFontId => CAPTION_FONT_IDS.has(family);
export const CAPTION_HIGHLIGHTS = ['none', 'color', 'box', 'pop', 'underline'] as const;

export const captionStyleSchema = z.object({
  version: z.literal(1),
  font: z.enum(CAPTION_FONTS),
  weight: z.int().min(100).max(900).multipleOf(100),
  /** On the 1080-wide canvas. */
  sizePx: z.int().min(44).max(160),
  textColor: hexColor,
  highlightColor: hexColor,
  stroke: z.object({ color: hexColor, widthPx: z.int().min(1).max(16) }).nullable(),
  background: z
    .object({
      color: hexColor,
      opacity: z.number().min(0).max(1),
      paddingPx: z.int().min(0).max(48),
      radiusPx: z.int().min(0).max(48),
    })
    .nullable(),
  highlight: z.enum(CAPTION_HIGHLIGHTS),
  /** 'upper' changes Latin letters only. */
  letterCase: z.enum(['asIs', 'upper']),
  /** Centre of the block as a fraction of frame height (0 is the top). Clamped into the preset's safe rect. */
  anchorY: z.number().min(0).max(1),
  maxLines: z.int().min(1).max(3),
  /** Words on screen at once; 1 is word by word. */
  maxWords: z.int().min(1).max(12),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const captionWordSchema = z.object({
  text: z.string().min(1).max(100),
  /** Timeline time, frame-aligned. */
  range: timeRangeSchema,
  /** 1 for words the user typed. */
  confidence: z.number().min(0).max(1),
});
export type CaptionWord = z.output<typeof captionWordSchema>;

export const captionCueSchema = z.object({
  id: idSchema<'CaptionCue'>(),
  range: timeRangeSchema,
  words: z.array(captionWordSchema).min(1).max(40),
  /** The user edited it; rebuilding from the transcript keeps it. */
  edited: z.boolean(),
});
export type CaptionCue = z.output<typeof captionCueSchema>;

export const CAPTION_STYLE_SOURCES = ['reference', 'preset', 'user'] as const;

/** A timeline's captions (`Timeline.captions`). */
export const captionTrackSchema = z.object({
  /** Burned into renders. */
  enabled: z.boolean(),
  /** BCP 47: 'en', 'hi', 'es', 'pt-BR'. */
  language: languageTagSchema,
  style: captionStyleSchema,
  styleSource: z.enum(CAPTION_STYLE_SOURCES),
  cues: z.array(captionCueSchema).max(5000),
});
export type CaptionTrack = z.output<typeof captionTrackSchema>;
