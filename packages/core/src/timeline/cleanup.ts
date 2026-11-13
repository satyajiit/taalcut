// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Talking-head cleanup (P3-V9, timeline SPEC "Cleanup"): the settings, and the plan `timelines.planCleanup`
 * makes from audio's SpeechCleanupAnalysis and `timeline.applyCleanup` applies in one undo step.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { defineSetting } from '../ports/preferences';
import { timeRangeSchema } from '../time/time-range';
import { clipReframeSchema } from './timeline-items';

export const cleanupSettingsSchema = z.object({
  fillers: z.boolean(),
  pauses: z.boolean(),
  retakes: z.boolean(),
  punchIns: z.boolean(),
  /** Pauses longer than this are shortened ("Shorten pauses longer than 0.5 s"). */
  pauseThresholdMs: z.int().min(200).max(2000),
  /** What is left of a shortened pause. */
  keepPauseMs: z.int().min(0).max(1000),
  /** Kept around every cut so words don't clip. */
  padMs: z.int().min(0).max(200),
  /** The punch-in's reframe scale (research: 5–10 % reads as natural). */
  punchScale: z.number().min(1.05).max(1.5),
  punchSeconds: z.number().min(1).max(6),
  punchMinGapSeconds: z.number().min(2).max(20),
  /** Emphasis strength from which a punch-in is placed. */
  punchThreshold: z.number().min(0).max(1),
});
export type CleanupSettings = z.output<typeof cleanupSettingsSchema>;

export const CLEANUP_SETTING = defineSetting('cleanup.defaults', cleanupSettingsSchema, {
  fillers: true,
  pauses: true,
  retakes: true,
  punchIns: true,
  pauseThresholdMs: 500,
  keepPauseMs: 150,
  padMs: 40,
  punchScale: 1.1,
  punchSeconds: 2.5,
  punchMinGapSeconds: 4,
  punchThreshold: 0.7,
});

export const cleanupPlanSchema = z.object({
  timelineId: idSchema<'Timeline'>(),
  /** The revision it was planned on: applying it to another is core.conflict. */
  revision: z.int().positive(),
  /**
   * Round P3-3: sha256 (lowercase hex) of the planned clips as they were when planned (id, media asset and
   * shot, sourceStart, duration, enabled, speed), canonical JSON. applyCleanup may accept a plan made on
   * another revision while this still matches. Absent on plans made before.
   */
  clipsFingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  clips: z
    .array(
      z.object({
        clipId: idSchema<'TimelineItem'>(),
        /** Kept source ranges in order, at the media's rate, whole canvas frames once placed. */
        keep: z.array(timeRangeSchema).min(1).max(400),
        /** Ids for the clips after the first (which keeps clipId), so redo makes the same document. */
        newIds: z.array(idSchema<'TimelineItem'>()).max(400),
        /** Source ranges that play punched in, with the reframe they get. */
        punch: z.array(z.object({ range: timeRangeSchema, reframe: clipReframeSchema })).max(100),
      }),
    )
    .max(200),
  stats: z.object({
    fillers: z.int().nonnegative(),
    pauses: z.int().nonnegative(),
    retakes: z.int().nonnegative(),
    punchIns: z.int().nonnegative(),
    secondsSaved: z.number().nonnegative(),
  }),
});
export type CleanupPlan = z.output<typeof cleanupPlanSchema>;
