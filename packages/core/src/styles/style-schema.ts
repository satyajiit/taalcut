// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Style v1 (P3-V10, P3-V17): a look any template or timeline can use, kept apart from structure. A brand kit
 * (colours, fonts, logo, watermark, intro and outro) or a look (a grade and a matched font measured from a
 * reference). Templates and timelines name it by `styleId`; render resolves it. Edits are STYLE_COMMANDS.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/id-schema';
import { CAPTION_FONTS, captionStyleSchema } from '../render/captions';
import { sha256Schema, styleKeySchema } from '../templates/template-parts';
import { FrameRates, FrameRateValue } from '../time/frame-rate-value';
import { RationalTime, rationalTimeSchema } from '../time/rational-time';
import { timeRangeSchema } from '../time/time-range';
import { fontMatchSchema, styleGradeSchema } from './look';
import { creatorProfileSchema } from './creator-profile';

export const STYLE_SCHEMA_VERSION = 1;
export const STYLE_KINDS = ['brandKit', 'look'] as const;
export type StyleKind = (typeof STYLE_KINDS)[number];
export const LOGO_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type LogoMediaType = (typeof LOGO_MEDIA_TYPES)[number];
/** What files.pickFile offers for a brand image; the bytes decide the type (LOGO_MEDIA_TYPES), never the name. */
export const LOGO_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
export const STYLE_CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const;
export const BUMPER_BACKGROUNDS = ['primary', 'secondary', 'background'] as const;
/** A logo: at most 5 MiB and 4096 px a side (checked from the bytes by @taalcut/templates, never by the name). */
export const LOGO_LIMITS = { bytes: 5 * 1024 * 1024, pixels: 4096 } as const;
/** Text styles a Style may set, keyed by an overlay's styleKey ('title', 'label', …). */
export const MAX_TEXT_STYLES = 16;

const hex = z.string().regex(/^#[0-9a-f]{6}$/);
const opacity = (min: number, max: number) => z.number().min(min).max(max);

export const styleFontSchema = z.object({
  family: z.enum(CAPTION_FONTS),
  weight: z.int().min(100).max(900).multipleOf(100),
});

export const textLookSchema = z.object({
  font: styleFontSchema,
  colour: hex,
  background: z.object({ colour: hex, opacity: opacity(0, 1) }).nullable(),
  stroke: z.object({ colour: hex, widthPx: z.int().min(1).max(16) }).nullable(),
});
export type TextLook = z.output<typeof textLookSchema>;

export const styleLogoSchema = z.object({
  /** sha256 of the image in the style asset store (app://media/styles/…). */
  asset: sha256Schema,
  mediaType: z.enum(LOGO_MEDIA_TYPES),
  width: z.int().min(16).max(LOGO_LIMITS.pixels),
  height: z.int().min(16).max(LOGO_LIMITS.pixels),
  placement: z.enum(STYLE_CORNERS),
  /** Of the canvas width. */
  scale: z.number().min(0.05).max(0.4),
  opacity: opacity(0.2, 1),
  showOn: z.enum(['always', 'introOutro']),
});
export type StyleLogo = z.output<typeof styleLogoSchema>;

export const styleWatermarkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('logo'), placement: z.enum(STYLE_CORNERS), opacity: opacity(0.1, 0.6) }),
  z.object({
    kind: z.literal('text'),
    /** The person's words: plain text. */
    text: z.string().trim().min(1).max(40),
    placement: z.enum(STYLE_CORNERS),
    opacity: opacity(0.1, 0.6),
  }),
]);

/** A title card's length: 1 to 4 s, at any rate (render rescales it to the timeline's rate, to the nearest frame). */
export const BUMPER_CARD_LIMITS = {
  min: RationalTime.of(1, FrameRateValue.of(1)),
  max: RationalTime.of(4, FrameRateValue.of(1)),
} as const;
export const bumperCardDurationSchema = rationalTimeSchema.refine(
  (time) =>
    !RationalTime.isBefore(time, BUMPER_CARD_LIMITS.min) &&
    !RationalTime.isAfter(time, BUMPER_CARD_LIMITS.max),
  { message: 'A title card lasts 1 to 4 seconds' },
);

const bumperCardSchema = z
  .object({
    kind: z.literal('card'),
    text: z.string().trim().min(1).max(80),
    duration: bumperCardDurationSchema.optional(),
    background: z.enum(BUMPER_BACKGROUNDS),
    /**
     * @deprecated Round P3-1's float seconds, read only so a Style stored then still parses; it becomes `duration`
     * in whole milliseconds. Write `duration`.
     */
    seconds: z.number().min(1).max(4).optional(),
  })
  .transform(({ seconds, duration, ...card }, context) => {
    if (duration) return { ...card, duration };
    if (seconds !== undefined)
      return { ...card, duration: RationalTime.fromSeconds(seconds, FrameRates.milliseconds) };
    context.addIssue({ code: 'custom', message: 'A title card has a duration', path: ['duration'] });
    return z.NEVER;
  });

export const styleBumperSchema = z.discriminatedUnion('kind', [
  /** A library clip; null range: the whole clip. A deleted asset makes render skip it with a QA warning. */
  z.object({ kind: z.literal('clip'), assetId: idSchema<'Asset'>(), range: timeRangeSchema.nullable() }),
  bumperCardSchema,
]);

/** Up to MAX_TEXT_STYLES looks, keyed by styleKey. */
export const textStylesSchema = z
  .record(styleKeySchema, textLookSchema)
  .refine((styles) => Object.keys(styles).length <= MAX_TEXT_STYLES, {
    message: `At most ${MAX_TEXT_STYLES} text styles`,
  });

export const styleColoursSchema = z.object({
  primary: hex,
  secondary: hex,
  accent: hex,
  text: hex,
  background: hex,
});

export const styleFontsSchema = z.object({ heading: styleFontSchema, body: styleFontSchema });

const styleFields = {
  creator: creatorProfileSchema.nullable().optional(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(STYLE_KINDS),
  colours: styleColoursSchema,
  fonts: styleFontsSchema,
  captions: captionStyleSchema.nullable(),
  textStyles: textStylesSchema,
  logo: styleLogoSchema.nullable(),
  watermark: styleWatermarkSchema.nullable(),
  intro: styleBumperSchema.nullable(),
  outro: styleBumperSchema.nullable(),
  /** P3-V17: a grade towards a measured look; null keeps the footage's colour. */
  grade: styleGradeSchema.nullable(),
  /** P3-V17: the reference's text font, matched among the curated fonts. */
  fontMatch: fontMatchSchema.nullable(),
  /** The template version a look was measured from ("Make a look from this template"). */
  madeFrom: z.object({ templateId: idSchema<'Template'>(), version: z.int().min(1) }).nullable(),
};

/** What `style.create` takes; the store adds the id, revision and times. */
export const styleInputSchema = z.object(styleFields);
export type StyleInput = z.output<typeof styleInputSchema>;

export const styleSchema = z.object({
  schemaVersion: z.literal(STYLE_SCHEMA_VERSION),
  id: idSchema<'Style'>(),
  /** Bumped by every write; edits name the revision they were made on. */
  revision: z.int().min(1),
  ...styleFields,
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});
export type Style = z.output<typeof styleSchema>;

/** What a Style can't be, beyond its shape: a logo watermark needs a logo. Problem keys, [] when it holds. */
export function styleProblems(style: Pick<StyleInput, 'watermark' | 'logo'>): string[] {
  return style.watermark?.kind === 'logo' && style.logo === null ? ['watermark.logoMissing'] : [];
}
