// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { rationalTimeSchema, RationalTime } from '../time/rational-time';
import { timeRangeSchema } from '../time/time-range';

export const SHORTS_PLATFORMS = ['reels', 'shorts'] as const;
export const shortsRequestSchema = z.object({
  projectId: idSchema<'Project'>(),
  assetId: idSchema<'Asset'>(),
  sourceUrl: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .optional(),
  duration: rationalTimeSchema.refine((time) => {
    const seconds = RationalTime.toSeconds(time);
    return seconds >= 15 && seconds <= 179;
  }, 'Shorts duration is between 15 and 179 seconds'),
  platforms: z.array(z.enum(SHORTS_PLATFORMS)).min(1).max(2),
  styleId: idSchema<'Style'>().optional(),
});
export type ShortsRequest = z.output<typeof shortsRequestSchema>;

/** Evidence always refers to the original media clock, even when dialogue is reordered. */
export const shortSourceSpanSchema = z.object({
  assetId: idSchema<'Asset'>(),
  range: timeRangeSchema,
  wordStart: z.int().nonnegative().optional(),
  wordEnd: z.int().nonnegative().optional(),
});
export type ShortSourceSpan = z.output<typeof shortSourceSpanSchema>;

export const shortCandidateSchema = z.object({
  id: idSchema<'ShortCandidate'>(),
  title: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  speech: z.array(shortSourceSpanSchema).max(100),
  visuals: z.array(shortSourceSpanSchema).min(1).max(100),
  hook: z.string().min(1).max(1000),
  context: z.string().max(2000),
  payoff: z.string().min(1).max(1000),
});
export type ShortCandidate = z.output<typeof shortCandidateSchema>;

export const shortTimedSpanSchema = z.object({
  source: shortSourceSpanSchema,
  start: rationalTimeSchema.refine((time) => time.value >= 0),
  duration: rationalTimeSchema.refine((time) => time.value > 0),
});
export type ShortTimedSpan = z.output<typeof shortTimedSpanSchema>;

export const shortEditPlanSchema = z.object({
  candidateId: idSchema<'ShortCandidate'>(),
  title: z.string().min(1).max(200),
  hook: z.string().max(1000),
  endingText: z.string().max(200).optional(),
  speech: z.array(shortTimedSpanSchema).max(100),
  visuals: z.array(shortTimedSpanSchema).min(1).max(100),
  duration: rationalTimeSchema.refine((time) => time.value > 0),
  /** An overlay on the ending footage, already included in duration. */
  endingDuration: rationalTimeSchema.refine((time) => time.value >= 0),
});
export type ShortEditPlan = z.output<typeof shortEditPlanSchema>;

export const SHORTS_RUN_STATUSES = [
  'queued',
  'running',
  'needsReview',
  'ready',
  'failed',
  'cancelled',
] as const;
export const shortsRunSchema = z.object({
  id: idSchema<'ShortsRun'>(),
  request: shortsRequestSchema,
  status: z.enum(SHORTS_RUN_STATUSES),
  stage: z.string().min(1).max(100),
  /** Source content and analysis identity used by this plan; checked before an interrupted run resumes. */
  sourceFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  candidates: z.array(shortCandidateSchema).max(20),
  plan: shortEditPlanSchema.optional(),
  timelineId: idSchema<'Timeline'>().optional(),
  revision: z.int().positive().optional(),
  renderIds: z.array(idSchema<'Render'>()).max(2).optional(),
  issues: z.array(z.string().max(2000)).max(50),
  error: z.string().max(2000).optional(),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});
export type ShortsRun = z.output<typeof shortsRunSchema>;
