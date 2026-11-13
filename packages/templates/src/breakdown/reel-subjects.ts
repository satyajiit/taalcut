// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: where people are in the reference reel (core's `ReelSubjects`), so placement can read how each overlay
 * sat relative to the reel's subject: whole heads and bodies a few times a second over the whole reel, from the
 * normalised file the rest of the breakdown reads (so the boxes are fractions of the template's canvas, inside a
 * screen recording's crop, like an overlay's box). Optional: with no subject analyser, or when it fails, the
 * template records none and placement keeps the reel's coordinates.
 */
import { ok, RationalTime, reelSubjectsSchema, type AsyncResult, type ReelSubjects } from '@taalcut/core';
import type { StepContext } from './steps';

/** Detections per second over the reel: every overlay that lasts a quarter of a second has one inside it. */
export const REEL_SUBJECTS_HZ = 4;

const unit = (value: number) => Math.min(1, Math.max(0, value));
type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
const clamped = (box: Box) => {
  const x = unit(box.x);
  const y = unit(box.y);
  return { x, y, width: unit(box.x + box.width) - x, height: unit(box.y + box.height) - y };
};
const scored = (entry: { readonly box: Box; readonly confidence: number }) => ({
  box: clamped(entry.box),
  confidence: unit(entry.confidence),
});

export async function readReelSubjects(ctx: StepContext): AsyncResult<ReelSubjects | null> {
  const subjects = ctx.analysers.vision.subjects;
  if (!subjects) return ok(null);
  const found = await subjects(ctx.path, {
    rate: ctx.rate,
    hz: REEL_SUBJECTS_HZ,
    frames: ctx.total,
    signal: ctx.signal,
  });
  if (!found.ok) return found;
  const samples = [...found.value.samples]
    .filter((sample) => sample.frame >= 0 && sample.frame < ctx.total)
    .sort((a, b) => a.frame - b.frame)
    .map((sample) => ({
      t: RationalTime.of(Math.round(sample.frame), ctx.rate),
      heads: sample.heads.slice(0, 16).map(scored),
      people: sample.people.slice(0, 16).map(scored),
    }));
  const parsed = reelSubjectsSchema.safeParse({
    version: 1,
    detector: found.value.detector,
    hz: REEL_SUBJECTS_HZ,
    samples: samples.slice(0, 4000),
  });
  return ok(parsed.success ? parsed.data : null);
}
