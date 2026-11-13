// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The parts a hub document reuses from Template v1 and Style v1, as the hub needs them: every object strict (an
 * unknown key anywhere is refused, so nothing private rides along in a nested object), and every schema converts
 * to JSON Schema (no transforms, no custom checks) for the hub repository's CI. A rate must already be reduced:
 * it is checked, never rewritten, so validating a file doesn't change the bytes its sha256 covers.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ULID_PATTERN, ulidSchema } from '../basics/id-schema';
import { captionStyleSchema } from '../render/captions';
import { MAX_TEXT_STYLES, styleColoursSchema, styleFontSchema, textLookSchema } from '../styles/style-schema';
import {
  beatAnchorSchema,
  beatMapSchema,
  boxSchema,
  canvasSchema,
  pacingStatsSchema,
  speedRampSchema,
  styleKeySchema,
  textAppearanceSchema,
  transitionSchema,
} from '../templates/template-parts';
import { FrameRateValue, frameRateJsonSchema } from '../time/frame-rate-value';

/** A hub template's id, in the file and in the index alike: an upper-case ULID. */
export const hubIdSchema = ulidSchema('HubTemplate');
/** The same check as data, for the hub repository's CI. */
export const HUB_ID_PATTERN = ULID_PATTERN;

export const hubRateSchema = frameRateJsonSchema
  .strict()
  .refine(FrameRateValue.isReduced, { message: 'Write the rate reduced (30/1, not 60/2)' });
export const hubTimeSchema = z.strictObject({ value: z.int(), rate: hubRateSchema });

export const hubCanvasSchema = canvasSchema.extend({ rate: hubRateSchema }).strict();
export const hubBeatMapSchema = beatMapSchema
  .extend({ rate: hubRateSchema, beats: z.array(hubTimeSchema).max(4000) })
  .strict();
export const hubBeatAnchorSchema = beatAnchorSchema.extend({ offset: hubTimeSchema }).strict();
export const hubTransitionSchema = transitionSchema
  .extend({ before: hubTimeSchema, after: hubTimeSchema })
  .strict();
const rampPoint = speedRampSchema.shape.points.element;
export const hubSpeedRampSchema = speedRampSchema
  .extend({
    windowStart: hubTimeSchema.optional(),
    points: z
      .array(rampPoint.extend({ at: hubTimeSchema }).strict())
      .min(2)
      .max(16),
  })
  .strict();
export const hubPacingStatsSchema = pacingStatsSchema
  .extend({
    meanShot: hubTimeSchema,
    medianShot: hubTimeSchema,
    shortestShot: hubTimeSchema,
    longestShot: hubTimeSchema,
    hookEnd: hubTimeSchema,
  })
  .strict();
export const hubBoxSchema = boxSchema.strict();
export const hubTextAppearanceSchema = textAppearanceSchema.strict();

const hubFont = styleFontSchema.strict();
const strictNullable = <T extends z.ZodObject>(schema: z.ZodNullable<T>) =>
  schema.unwrap().strict().nullable();

export const hubCaptionStyleSchema = captionStyleSchema
  .extend({
    stroke: strictNullable(captionStyleSchema.shape.stroke),
    background: strictNullable(captionStyleSchema.shape.background),
  })
  .strict();
export const hubTextLookSchema = textLookSchema
  .extend({
    font: hubFont,
    background: strictNullable(textLookSchema.shape.background),
    stroke: strictNullable(textLookSchema.shape.stroke),
  })
  .strict();

/** A Style without any asset: colours, curated fonts, caption look, text looks. */
export const hubStyleV0Schema = z.strictObject({
  colours: styleColoursSchema.strict(),
  fonts: z.strictObject({ heading: hubFont, body: hubFont }),
  captions: hubCaptionStyleSchema.nullable(),
  textStyles: z
    .record(styleKeySchema, hubTextLookSchema)
    .refine((styles) => Object.keys(styles).length <= MAX_TEXT_STYLES, {
      message: `At most ${MAX_TEXT_STYLES} text styles`,
    }),
});
export type HubStyleV0 = z.output<typeof hubStyleV0Schema>;
