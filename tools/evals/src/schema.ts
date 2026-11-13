// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

/**
 * Golden-set labels. Every time is an integer frame at the reel's own rate.
 * 30000/1001 stays two integers, so NTSC rates are exact.
 */

const reelIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'reelId must be lowercase words separated by hyphens');

const languageSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Z][A-Za-z0-9]{1,7})*$/, 'language must look like en, hi, es, or pt-BR');

export const frameRateSchema = z
  .object({
    numerator: z.number().int().positive(),
    denominator: z.number().int().positive(),
  })
  .strict();

export const audioTypeSchema = z.enum(['speech', 'music', 'silence', 'mixed', 'ambience']);
export const beatKindSchema = z.enum(['downbeat', 'beat', 'onset']);
export const transitionKindSchema = z.enum(['cut', 'dissolve', 'wipe', 'fade', 'other']);

const positionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1).optional(),
    height: z.number().min(0).max(1).optional(),
  })
  .strict();

const sourceSchema = z
  .object({
    label: z.string().min(1),
    uri: z.string().min(1).optional(),
    durationFrames: z.number().int().positive(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

const beatSchema = z.object({ frame: z.number().int().nonnegative(), kind: beatKindSchema }).strict();

const slotSchema = z
  .object({
    id: z.string().min(1),
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().nonnegative(),
    intent: z.string().min(1),
  })
  .strict();

const overlaySchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().nonnegative(),
    position: positionSchema,
  })
  .strict();

const transitionSchema = z
  .object({
    atFrame: z.number().int().nonnegative(),
    kind: transitionKindSchema,
  })
  .strict();

function inReel(frame: number, duration: number): boolean {
  return frame >= 0 && frame < duration;
}

export const goldenReelSchema = z
  .object({
    reelId: reelIdSchema,
    synthetic: z.boolean(),
    note: z.string().min(1),
    source: sourceSchema,
    frameRate: frameRateSchema,
    cuts: z.array(z.number().int().nonnegative()),
    beats: z.array(beatSchema),
    slots: z.array(slotSchema),
    overlays: z.array(overlaySchema),
    transitions: z.array(transitionSchema),
    audio: z.object({ type: audioTypeSchema }).strict(),
    languages: z.array(languageSchema).min(1),
  })
  .strict()
  .superRefine((reel, ctx) => {
    const duration = reel.source.durationFrames;
    reel.cuts.forEach((frame, index) => {
      if (!inReel(frame, duration)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cuts', index],
          message: `cut ${frame} must be a frame inside [0, ${duration})`,
        });
      }
      const previous = reel.cuts[index - 1];
      if (previous !== undefined && frame <= previous) {
        ctx.addIssue({
          code: 'custom',
          path: ['cuts', index],
          message: 'cuts must be strictly increasing',
        });
      }
    });
    reel.beats.forEach((beat, index) => {
      if (!inReel(beat.frame, duration)) {
        ctx.addIssue({
          code: 'custom',
          path: ['beats', index, 'frame'],
          message: `beat ${beat.frame} must be a frame inside [0, ${duration})`,
        });
      }
    });
    for (const [list, label] of [
      [reel.slots, 'slots'],
      [reel.overlays, 'overlays'],
    ] as const) {
      list.forEach((span, index) => {
        if (span.startFrame >= span.endFrame) {
          ctx.addIssue({
            code: 'custom',
            path: [label, index, 'endFrame'],
            message: `${label} endFrame must be after startFrame (half-open)`,
          });
        }
        if (span.startFrame < 0 || span.endFrame > duration) {
          ctx.addIssue({
            code: 'custom',
            path: [label, index],
            message: `${label} must lie inside [0, ${duration}]`,
          });
        }
      });
    }
    reel.transitions.forEach((transition, index) => {
      if (!inReel(transition.atFrame, duration)) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', index, 'atFrame'],
          message: `transition ${transition.atFrame} must be a frame inside [0, ${duration})`,
        });
      }
    });
    const seen = new Set<string>();
    reel.languages.forEach((language, index) => {
      if (seen.has(language)) {
        ctx.addIssue({
          code: 'custom',
          path: ['languages', index],
          message: `duplicate language ${language}`,
        });
      }
      seen.add(language);
    });
  });

export const predictionReelSchema = z
  .object({
    reelId: reelIdSchema,
    cuts: z.array(z.number().int().nonnegative()),
  })
  .strict()
  .superRefine((prediction, ctx) => {
    prediction.cuts.forEach((frame, index) => {
      const previous = prediction.cuts[index - 1];
      if (previous !== undefined && frame <= previous) {
        ctx.addIssue({
          code: 'custom',
          path: ['cuts', index],
          message: 'predicted cuts must be strictly increasing',
        });
      }
    });
  });

export type FrameRate = z.infer<typeof frameRateSchema>;
export type GoldenReel = z.infer<typeof goldenReelSchema>;
export type PredictionReel = z.infer<typeof predictionReelSchema>;

export function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join('\n');
}

export function parseGoldenReel(input: unknown, label = 'golden reel'): GoldenReel {
  return parseNamed(goldenReelSchema, input, label);
}

export function parsePredictionReel(input: unknown, label = 'prediction'): PredictionReel {
  return parseNamed(predictionReelSchema, input, label);
}

export function goldenJsonSchema(): unknown {
  return z.toJSONSchema(goldenReelSchema);
}

/** `schema`'s reading of `value`, or an error that names `where` and lists every issue. */
export function parseNamed<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${where}\n${formatIssues(parsed.error)}`);
  return parsed.data;
}
