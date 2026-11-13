// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB (contract §1): where people are in the reference reel, so placement can read how each overlay sat
 * relative to the reel's subject (ovl's `placement` relation). One time-ordered list over the whole reel rather
 * than one per overlay or per slot: any overlay's or slot's span is a filter of it (`reelSubjectsDuring`), and it
 * stays right when the review moves an overlay or merges slots.
 *
 * Boxes are fractions of the reel's picture as the template's canvas shows it (inside a screen recording's crop),
 * origin top left: the same space as an overlay's `box`. Boxes only, no identity (vision SPEC P3.4).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { SUBJECT_DETECTORS } from '../render/subject-track';
import { RationalTime, rationalTimeSchema } from '../time/rational-time';
import { boxSchema } from './template-parts';

const scored = z.object({ box: boxSchema, confidence: z.number().min(0).max(1) }).strict();

export const reelSubjectSampleSchema = z
  .object({
    /** Reel time, at the template's rate. */
    t: rationalTimeSchema,
    /** Each person's whole head, hair included (seen from any side). */
    heads: z.array(scored).max(16),
    /** Each person's whole visible body. */
    people: z.array(scored).max(16),
  })
  .strict();
export type ReelSubjectSample = z.output<typeof reelSubjectSampleSchema>;

export const reelSubjectsSchema = z
  .object({
    version: z.literal(1),
    detector: z.enum(SUBJECT_DETECTORS),
    /** Samples per second over the reel; every slot and every overlay also has at least one inside it. */
    hz: z.number().positive().max(30),
    samples: z.array(reelSubjectSampleSchema).max(4000),
  })
  .strict();
export type ReelSubjects = z.output<typeof reelSubjectsSchema>;

/**
 * The samples inside [start, start + duration) of the reel, in time order; with none inside (a span shorter than
 * a sample's step), the one nearest its middle.
 */
export function reelSubjectsDuring(
  subjects: ReelSubjects,
  start: RationalTime,
  duration: RationalTime,
): ReelSubjectSample[] {
  const from = RationalTime.toSeconds(start);
  const to = from + RationalTime.toSeconds(duration);
  const inside = subjects.samples.filter((sample) => {
    const t = RationalTime.toSeconds(sample.t);
    return t >= from && t < to;
  });
  if (inside.length > 0 || subjects.samples.length === 0) return inside;
  const middle = (from + to) / 2;
  let nearest = subjects.samples[0]!;
  for (const sample of subjects.samples)
    if (
      Math.abs(RationalTime.toSeconds(sample.t) - middle) <
      Math.abs(RationalTime.toSeconds(nearest.t) - middle)
    )
      nearest = sample;
  return [nearest];
}
