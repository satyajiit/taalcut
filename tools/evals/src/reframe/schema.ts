// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { loadLabelRows, loadPredictionRows } from '../labelled-files';

const idSchema = z.string().min(1);

const boxSampleSchema = z
  .object({
    tFrame: z.number().int().nonnegative(),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    w: z.number().positive(),
    h: z.number().positive(),
  })
  .strict();

/** A labelled frame with no subject. Fallback there is correct, not a miss. */
const emptySampleSchema = z
  .object({
    tFrame: z.number().int().nonnegative(),
  })
  .strict();

export const reframeSampleSchema = z.union([boxSampleSchema, emptySampleSchema]);

const sizeSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();

export const reframeClipLabelSchema = z
  .object({
    clipId: idSchema,
    synthetic: z.boolean(),
    fps: z.number().positive(),
    /** Output frames the crop path is scored over. */
    frames: z.number().int().positive(),
    source: sizeSchema,
    canvas: sizeSchema,
    /** Subject box at 4 fps, source pixels. No x/y/w/h means no subject. */
    samples: z.array(reframeSampleSchema).min(1),
  })
  .strict();

const centreSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
  })
  .strict();

/** The planner's framing for the clip: `subject` when it followed one, otherwise its fallback (or `fit`). */
export const FRAMING_OUTCOMES = [
  'subject',
  'forced',
  'noSubject',
  'wideStatic',
  'subjectTooTall',
  'noTrack',
  'fit',
] as const;

export const reframePredictionSchema = z
  .object({
    clipId: idSchema,
    framing: z.enum(FRAMING_OUTCOMES),
    /** Crop window at each labelled frame, source pixels. Empty when the plan did not crop. */
    crops: z.array(
      z
        .object({
          tFrame: z.number().int().nonnegative(),
          x: z.number(),
          y: z.number(),
          w: z.number().positive(),
          h: z.number().positive(),
        })
        .strict(),
    ),
    /** Crop centre and size at every output frame, source pixels. Empty when there is no crop path. */
    centres: z.array(centreSchema),
    /**
     * Frames measureJitter flagged (hold or wobble), in output frames. The speed check is separate and
     * computed from `centres`; these are unioned in so a wobble the speed cap allows still counts.
     */
    qaJitterFrames: z.array(z.number().int().nonnegative()).default([]),
  })
  .strict();

export const reframeLabelFileSchema = z.array(reframeClipLabelSchema).min(1);
export const reframePredictionFileSchema = z.array(reframePredictionSchema).min(1);

export type ReframeSample = z.infer<typeof reframeSampleSchema>;
export type ReframeClipLabel = z.infer<typeof reframeClipLabelSchema>;
export type ReframePrediction = z.infer<typeof reframePredictionSchema>;

export function reframeJsonSchema(): unknown {
  return z.toJSONSchema(reframeClipLabelSchema);
}

export function loadReframeLabels(dir: string): ReframeClipLabel[] {
  return loadLabelRows(dir, {
    what: 'reframe labels',
    schema: reframeLabelFileSchema,
    idOf: (row) => row.clipId,
    idName: 'clipId',
  });
}

export function loadReframePredictions(dir: string): Map<string, ReframePrediction> {
  return loadPredictionRows(dir, {
    what: 'reframe predictions',
    schema: reframePredictionFileSchema,
    idOf: (row) => row.clipId,
  });
}
