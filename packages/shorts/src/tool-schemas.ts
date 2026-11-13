// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { rationalTimeJsonSchema, SHORTS_PLATFORMS, SHORTS_RUN_STATUSES, ulidSchema } from '@taalcut/core';
import { z } from 'zod';

/** Model-facing schemas stay JSON representable; the service and stores validate core's stronger schemas. */
export const shortsRequestToolSchema = z.object({
  projectId: ulidSchema('Project'),
  assetId: ulidSchema('Asset'),
  sourceUrl: z.url().max(2048).optional(),
  duration: rationalTimeJsonSchema.default({ value: 60, rate: { num: 1, den: 1 } }),
  platforms: z.array(z.enum(SHORTS_PLATFORMS)).min(1).max(2).default(['reels', 'shorts']),
  styleId: ulidSchema('Style').optional(),
});
const sourceSpan = z.object({
  assetId: ulidSchema('Asset'),
  range: z.object({ start: rationalTimeJsonSchema, duration: rationalTimeJsonSchema }),
  wordStart: z.int().nonnegative().optional(),
  wordEnd: z.int().nonnegative().optional(),
});
const candidate = z.object({
  id: ulidSchema('ShortCandidate'),
  title: z.string(),
  reason: z.string(),
  speech: z.array(sourceSpan),
  visuals: z.array(sourceSpan),
  hook: z.string(),
  context: z.string(),
  payoff: z.string(),
});
const timed = z.object({
  source: sourceSpan,
  start: rationalTimeJsonSchema,
  duration: rationalTimeJsonSchema,
});
const plan = z.object({
  candidateId: ulidSchema('ShortCandidate'),
  title: z.string(),
  hook: z.string(),
  endingText: z.string().optional(),
  speech: z.array(timed),
  visuals: z.array(timed),
  duration: rationalTimeJsonSchema,
  endingDuration: rationalTimeJsonSchema,
});
export const shortsRunToolSchema = z.object({
  id: ulidSchema('ShortsRun'),
  request: shortsRequestToolSchema,
  status: z.enum(SHORTS_RUN_STATUSES),
  stage: z.string(),
  candidates: z.array(candidate),
  sourceFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  plan: plan.optional(),
  timelineId: ulidSchema('Timeline').optional(),
  revision: z.int().positive().optional(),
  renderIds: z.array(ulidSchema('Render')).optional(),
  issues: z.array(z.string()),
  error: z.string().optional(),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});
