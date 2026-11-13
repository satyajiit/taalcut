// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shapes of the breakdown's vision half (P2-T4). Plain zod objects without
 * transforms: they cross the job queue as JSON and become tool schemas the
 * model reads, so every one must convert to JSON Schema. Times are core's
 * RationalTime shape on the source's frame grid.
 */
import {
  CUT_METHODS,
  FrameRate,
  OCR_REVEALS,
  RationalTime,
  TEXT_SCRIPTS,
  TRANSITION_KINDS,
  type OnScreenText,
  type TimeRange,
} from '@taalcut/core';
import { z } from 'zod';

export const frameRatePlainSchema = z.object({ num: z.int().positive(), den: z.int().positive() });
export const rationalTimePlainSchema = z.object({
  value: z.int().describe('Whole frames at `rate`'),
  rate: frameRatePlainSchema.describe('Frames per second as num/den, e.g. {"num": 30000, "den": 1001}'),
});
export const timeRangePlainSchema = z.object({
  start: rationalTimePlainSchema,
  duration: rationalTimePlainSchema,
});
export type RationalTimePlain = z.output<typeof rationalTimePlainSchema>;
export type TimeRangePlain = z.output<typeof timeRangePlainSchema>;

export const CUT_STATUSES = ['confirmed', 'disputed', 'unverified'] as const;
export type CutStatus = (typeof CUT_STATUSES)[number];
export type CutMethod = (typeof CUT_METHODS)[number];
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export const breakdownCutSchema = z.object({
  /** First frame of the new shot (scdet's convention), on the source grid. */
  frame: z.int().nonnegative(),
  at: rationalTimePlainSchema,
  kind: z.enum(['hard', 'soft']),
  transition: z.enum(TRANSITION_KINDS).optional(),
  confidence: z.number().min(0).max(1),
  method: z.enum(CUT_METHODS),
  status: z.enum(CUT_STATUSES),
  /** scdet score 0–100 at the cut, when scdet proposed it. */
  score: z.number().min(0).max(100).optional(),
  /** Cosine distance between the frames around it (hard) or the neighbouring samples (soft). */
  distance: z.number().min(0).max(2).optional(),
});
export type BreakdownCut = z.output<typeof breakdownCutSchema>;

export const cutListSchema = z.object({
  frameRate: frameRatePlainSchema,
  frameCount: z.int().nonnegative(),
  cuts: z.array(breakdownCutSchema).max(2000),
  /** Samples a second of the soft-cut scan (0 when it could not run: no embedding model). */
  softScanFps: z.number().min(0),
  /** Plain-language notes on what ran, e.g. the Minimum tier's slower soft-cut scan. */
  notes: z.array(z.string().max(200)).max(8),
});
export type CutList = z.output<typeof cutListSchema>;

/** core's OnScreenText as a plain object (box, range, confidence, script, reveal). */
export const onScreenTextPlainSchema = z.object({
  text: z.string().min(1).max(500),
  box: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }),
  range: timeRangePlainSchema,
  confidence: z.number().min(0).max(1),
  script: z.enum(TEXT_SCRIPTS),
  language: z.string().max(35).optional(),
  reveal: z.enum(OCR_REVEALS),
});
export type OnScreenTextPlain = z.output<typeof onScreenTextPlainSchema>;

export function plainRate(rate: FrameRate): { num: number; den: number } {
  return { num: rate.num, den: rate.den };
}

export function plainTime(frame: number, rate: FrameRate): RationalTimePlain {
  return { value: frame, rate: plainRate(rate) };
}

export function plainOnScreenText(item: OnScreenText): OnScreenTextPlain {
  return {
    text: item.text,
    box: { x: item.box.x, y: item.box.y, width: item.box.width, height: item.box.height },
    range: {
      start: { value: item.range.start.value, rate: plainRate(item.range.start.rate) },
      duration: { value: item.range.duration.value, rate: plainRate(item.range.duration.rate) },
    },
    confidence: item.confidence,
    script: item.script,
    ...(item.language ? { language: item.language } : {}),
    reveal: item.reveal,
  };
}

/** A time on another grid, as the nearest frame of `rate`. */
export function frameOf(time: RationalTimePlain, rate: FrameRate): number {
  return RationalTime.toFrames(RationalTime.of(time.value, FrameRate.of(time.rate.num, time.rate.den)), rate);
}

/** A plain range as grid frames [start, end). */
export function framesOf(range: TimeRangePlain, rate: FrameRate): { start: number; end: number } {
  const start = frameOf(range.start, rate);
  const duration = RationalTime.toFrames(
    RationalTime.of(range.duration.value, FrameRate.of(range.duration.rate.num, range.duration.rate.den)),
    rate,
  );
  return { start: Math.max(0, start), end: Math.max(start, start + duration) };
}

/** core's TimeRange of grid frames [start, end). */
export function gridRange(start: number, end: number, rate: FrameRate): TimeRange {
  return { start: RationalTime.of(start, rate), duration: RationalTime.of(Math.max(0, end - start), rate) };
}
