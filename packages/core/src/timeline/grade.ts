// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: a colour grade a person or the Editor sets on clips or on the whole video (`timeline.setGrade`).
 * Plain adjustments and a named look, not a measured look (that is a Style's `grade`, P3-V17). Render draws it
 * as a colour matrix and optional highlight curves on each picture, the same in preview and export.
 * A clip's own grade applies on top of the video's.
 */
import '../basics/zod-config';
import { z } from 'zod';

/** The named looks: each a fixed colour change, mixed in by `lookStrength`. */
export const GRADE_LOOKS = [
  'vivid',
  'muted',
  'warm',
  'cool',
  'mono',
  'vintage',
  'faded',
  'cinematic',
] as const;
export type GradeLook = (typeof GRADE_LOOKS)[number];

export const gradeSchema = z.object({
  /** In stops: +1 doubles the light, −1 halves it. */
  exposure: z.number().min(-2).max(2),
  /** −1 flat, +1 twice the contrast. */
  contrast: z.number().min(-1).max(1),
  /** Bright-tone roll-off: −1 softens highlights, +1 lifts them. Missing means 0 in older timelines. */
  highlights: z.number().min(-1).max(1).optional(),
  /** Uppermost tones: −1 lowers whites, +1 lifts them. Missing means 0 in older timelines. */
  whites: z.number().min(-1).max(1).optional(),
  /** −1 black and white, +1 twice the colour. */
  saturation: z.number().min(-1).max(1),
  /** −1 cool (blue), +1 warm (orange). */
  temperature: z.number().min(-1).max(1),
  /** −1 green, +1 magenta. */
  tint: z.number().min(-1).max(1),
  look: z.enum(GRADE_LOOKS).nullable(),
  /** How much of the look: 1 is all of it. */
  lookStrength: z.number().min(0).max(1),
});
export type Grade = z.output<typeof gradeSchema>;

/** A change to a grade: the fields given replace the grade's, the rest stay. */
export const gradePatchSchema = gradeSchema.partial();
export type GradePatch = z.output<typeof gradePatchSchema>;

/** No change: what an ungraded clip or video shows. */
export const NEUTRAL_GRADE: Grade = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  look: null,
  lookStrength: 1,
};

/** True when the grade changes nothing (so a command can store none instead). */
export function isNeutralGrade(grade: Grade): boolean {
  return (
    grade.exposure === 0 &&
    grade.contrast === 0 &&
    (grade.highlights ?? 0) === 0 &&
    (grade.whites ?? 0) === 0 &&
    grade.saturation === 0 &&
    grade.temperature === 0 &&
    grade.tint === 0 &&
    (grade.look === null || grade.lookStrength === 0)
  );
}
