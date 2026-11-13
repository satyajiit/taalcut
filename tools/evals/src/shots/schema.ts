// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shot-boundary eval's formats (IX2-C1). Labels are a footage manifest's clips (the bench's generated sets
 * list every cut, dissolve and fade through black with its time, `@taalcut/bench-footage`'s manifest.json): only the fields read
 * here are checked, so a manifest with more fields still parses. Predictions are what a detector found, one
 * entry per clip: the first frame of each new shot on the clip's grid and, when the detector reports one, the
 * transition's frame span.
 */
import { z } from 'zod';

export const labelledClipSchema = z.object({
  file: z.string().min(1),
  fps: z.number().positive(),
  seconds: z.number().positive(),
  /**
   * `at`: where the new shot starts (seconds); a dissolve runs from `at` for `seconds`, and so does a fade through
   * black (IX3-D3: from the fade out's first frame to the fade in's last, the black between).
   */
  cuts: z.array(
    z.object({
      at: z.number().nonnegative(),
      kind: z.enum(['cut', 'dissolve', 'fade']),
      seconds: z.number(),
    }),
  ),
});
export type LabelledClip = z.output<typeof labelledClipSchema>;

export const shotLabelsSchema = z.object({
  set: z.string().min(1),
  clips: z.array(labelledClipSchema).min(1),
});
export type ShotLabels = z.output<typeof shotLabelsSchema>;

export const predictedBoundarySchema = z.object({
  /** First frame of the new shot, on the clip's grid. */
  frame: z.int().nonnegative(),
  /** What the detector called it; absent when it doesn't say. */
  kind: z.enum(['cut', 'dissolve', 'fade']).optional(),
  /** The transition's frames [from, to] when the detector reports a gradual one. */
  span: z.object({ from: z.int().nonnegative(), to: z.int().nonnegative() }).optional(),
});
export type PredictedBoundary = z.output<typeof predictedBoundarySchema>;

/** The detector's thread's event-loop delay over a clip, ms (loop-delay.ts). */
export const loopDelaySchema = z.object({
  p50: z.number().nonnegative(),
  p99: z.number().nonnegative(),
  max: z.number().nonnegative(),
  mean: z.number().nonnegative(),
});
export type LoopDelay = z.output<typeof loopDelaySchema>;

export const clipPredictionSchema = z.object({
  file: z.string().min(1),
  /** Which detector decided the clip: the model, or scdet (its fallback); absent in runs before IX2-S7. */
  detector: z.enum(['model', 'scdet']).optional(),
  boundaries: z.array(predictedBoundarySchema),
  /** Milliseconds per part of the detector (pass, scdet, confirm, model, …), for the report. */
  timings: z.record(z.string(), z.number().nonnegative()).optional(),
  loop: loopDelaySchema.optional(),
});
export type ClipPrediction = z.output<typeof clipPredictionSchema>;

export const shotPredictionsSchema = z.object({
  /** Which detector and where from: `stored:<library>`, `scdet+confirm`, `transnetv2`, … */
  detector: z.string().min(1),
  clips: z.array(clipPredictionSchema),
});
export type ShotPredictions = z.output<typeof shotPredictionsSchema>;
