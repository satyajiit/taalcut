// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-MOT (contract §3): the camera's move, measured from the video rather than guessed from two frames. Vision's
 * estimator fits the background's shift, scale and roll between frame pairs (about 10 a second) with the subject
 * kept out, and its classifier turns a shot's path into these numbers and a label. A template slot carries the
 * measure of its shot (`motionMeasure`), and the breakdown writes the slot's `intent.motion` from it; a library
 * shot's analysis carries the same measure, so casting compares like with like.
 *
 * The numbers are the camera's: pan positive to the right, tilt positive down, scale positive in (pushing in),
 * rotation positive clockwise. `version` is the estimator's: a measure of another version is measured again.
 */
import '../basics/zod-config';
import { z } from 'zod';

export const CAMERA_MOTIONS = [
  'static',
  'pan',
  'tilt',
  'push-in',
  'pull-out',
  'handheld',
  'tracking',
] as const;

/** Rates past these are no camera move a person makes; the estimator clamps to them. */
export const CAMERA_MOTION_MEASURE_MAX = { rate: 20, jitter: 1 } as const;

const rate = z.number().min(-CAMERA_MOTION_MEASURE_MAX.rate).max(CAMERA_MOTION_MEASURE_MAX.rate);

export const cameraMotionMeasureSchema = z.object({
  /** Frame widths a second, the camera panning right: +. */
  panX: rate,
  /** Frame heights a second, tilting down: +. */
  panY: rate,
  /** Log-scale a second, pushing in: +. */
  scale: rate,
  /** Radians a second, rolling clockwise: +. */
  rotation: rate,
  /** Shake: RMS distance from the camera's slow path, as a share of the frame's long side. */
  jitter: z.number().min(0).max(CAMERA_MOTION_MEASURE_MAX.jitter),
  /** The subject held still in the frame while the background moved; absent when no subject was seen. */
  subjectSteady: z.boolean().optional(),
  /** The classifier's label, sure or not; null when nothing could be measured (a flat or black shot). */
  label: z.enum(CAMERA_MOTIONS).nullable(),
  /** 0–1: under the breakdown's line the slot's motion stays unknown and the review asks (`motionUnsure`). */
  confidence: z.number().min(0).max(1),
  /** The estimator's version. */
  version: z.int().positive(),
});
export type CameraMotionMeasure = z.output<typeof cameraMotionMeasureSchema>;
