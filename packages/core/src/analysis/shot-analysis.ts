// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What vision found in a shot (P2-L8): quality, motion, energy, on-screen
 * text, a perceptual hash, casting's motion and sharpness curves and, when a
 * model may run, a description. The library stores it on the Shot; timeline's
 * casting reads it; templates and the renderer show it. It reuses the
 * template parts' enums and box, so a shot and a slot intent are compared on
 * one vocabulary, and a reference's overlay and an asset's on-screen text
 * share one box.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { timeRangeSchema, type TimeRange } from '../time/time-range';
import {
  boxSchema,
  CAMERA_MOTIONS,
  languageTagSchema,
  SHOT_TYPES,
  type TEXT_REVEALS,
} from '../templates/template-parts';
import { cameraMotionMeasureSchema, type CameraMotionMeasure } from '../templates/camera-motion';
import { ORIENTATIONS, type Orientation } from './media-facts';

const unit = z.number().min(0).max(1);

/** Normalised to the upright frame, origin top left (the template parts' box). */
export type NormalisedBox = z.output<typeof boxSchema>;
export type ShotType = (typeof SHOT_TYPES)[number];
export type CameraMotion = (typeof CAMERA_MOTIONS)[number];

export const TEXT_SCRIPTS = ['latin', 'devanagari', 'other'] as const;
export type TextScript = (typeof TEXT_SCRIPTS)[number];

type TextReveal = (typeof TEXT_REVEALS)[number];
/** What OCR tracking can see of a reveal; fade, pop and slide need the vision model. */
export const OCR_REVEALS = ['none', 'typewriter', 'wordByWord'] as const satisfies readonly TextReveal[];

/** On-screen text and when it shows, on the source's frame grid. Untrusted data read off pixels. */
export interface OnScreenText {
  /** NFC, whitespace collapsed. */
  readonly text: string;
  readonly box: NormalisedBox;
  readonly range: TimeRange;
  readonly confidence: number;
  readonly script: TextScript;
  readonly language?: string;
  /** 'wordByWord' or 'typewriter': the text grows in the same box, sample by sample. */
  readonly reveal: (typeof OCR_REVEALS)[number];
}

export const onScreenTextSchema: z.ZodType<OnScreenText> = z.object({
  text: z.string().min(1).max(500),
  box: boxSchema,
  range: timeRangeSchema,
  confidence: unit,
  script: z.enum(TEXT_SCRIPTS),
  language: languageTagSchema.optional(),
  reveal: z.enum(OCR_REVEALS),
});

export const QUALITY_FLAGS = ['blurry', 'dark', 'overexposed', 'shaky', 'flat', 'black', 'frozen'] as const;
export type QualityFlag = (typeof QUALITY_FLAGS)[number];

export interface QualityScores {
  /** Calibration version of the scores below. */
  readonly version: number;
  /** 0..1, 1 is best. */
  readonly sharpness: number;
  readonly exposure: number;
  readonly stability: number;
  readonly overall: number;
  readonly flags: readonly QualityFlag[];
}

export const qualityScoresSchema: z.ZodType<QualityScores> = z.object({
  version: z.int().positive(),
  sharpness: unit,
  exposure: unit,
  stability: unit,
  overall: unit,
  flags: z.array(z.enum(QUALITY_FLAGS)).max(QUALITY_FLAGS.length),
});

export const DESCRIPTION_SKIPPED_REASONS = ['no_local_model', 'no_consent', 'not_yet'] as const;

/**
 * What people (or animals) in a shot are doing (LIB1-FIND): the describer's fixed words, lowercase -ing phrases. A
 * shot's `actions` lists these first, then any free words the model needed. Fixed words are the ones the library's
 * action filter offers and the renderer can translate; free words are model output, shown as written.
 */
export const SHOT_ACTIONS = [
  'dancing',
  'walking',
  'running',
  'jumping',
  'cycling',
  'swimming',
  'surfing',
  'skateboarding',
  'climbing',
  'hiking',
  'paddling',
  'riding',
  'driving',
  'exercising',
  'playing sport',
  'talking',
  'singing',
  'laughing',
  'eating',
  'drinking',
  'cooking',
  'pouring',
  'chopping',
  'reading',
  'writing',
  'painting',
  'playing music',
  'playing',
  'clapping',
  'waving',
  'hugging',
  'posing',
  'taking a selfie',
  'filming',
  'shopping',
  'praying',
  'celebrating',
  'sleeping',
  'working',
  'performing',
] as const;
export type ShotAction = (typeof SHOT_ACTIONS)[number];

/** Caps on a shot's actions: how many, and how long one may be. */
export const SHOT_ACTION_LIMITS = { count: 8, chars: 32 } as const;

/** One action as stored: a fixed word or a short free one, lowercase. Untrusted model output. */
export const shotActionSchema = z
  .string()
  .min(1)
  .max(SHOT_ACTION_LIMITS.chars)
  .regex(/^[\p{Ll}\p{Lo}\p{M}\p{N}' -]+$/u);

export interface ShotDescription {
  readonly text: string;
  readonly objects: readonly string[];
  readonly place?: string;
  readonly shotType?: ShotType;
  readonly people?: number;
  /**
   * What is happening (LIB1-FIND): fixed words (SHOT_ACTIONS) first, then free ones; lowercase, at most 8.
   * Absent from descriptions made before LIB1, and when nothing is happening.
   */
  readonly actions?: readonly string[];
  readonly model: { readonly provider: string; readonly model: string; readonly local: boolean };
}

/**
 * Casting's per-shot curves and peaks (the casting research note), from vision's analysis pass: where in a shot the
 * motion and the focus are, so an in-point can put a motion peak within a frame of a beat.
 */
export interface ShotSignals {
  /** Calibration version of the curves and peaks. */
  readonly version: number;
  /** 100 ms samples from the shot's start, 0..1. Empty past an hour (36,000 samples). */
  readonly motionCurve: readonly number[];
  /** 100 ms samples from the shot's start, 0..1, 1 sharp. Empty past an hour. */
  readonly sharpnessCurve: readonly number[];
  /** Frames from the shot's start, on the asset's grid, where motion peaks (full rate); the strongest 400. */
  readonly motionPeakFrames: readonly number[];
}

export const shotSignalsSchema: z.ZodType<ShotSignals> = z.object({
  version: z.int().positive(),
  motionCurve: z.array(unit).max(36_000),
  sharpnessCurve: z.array(unit).max(36_000),
  motionPeakFrames: z.array(z.int().nonnegative()).max(400),
});

export interface ShotAnalysis {
  readonly version: 1;
  /** The shot within its asset, on the asset's frame grid. */
  readonly range: TimeRange;
  /** Index on the grid, relative to range.start: the sharpest sampled frame. */
  readonly bestFrame: number;
  readonly orientation: Orientation;
  readonly quality: QualityScores;
  /** FRM1-MOT: from `motionMeasure` once the shot was measured (any label); before, scoreShot's class. */
  readonly motion?: CameraMotion;
  /** FRM1-MOT: the camera's move, measured as the breakdown measures a slot's; absent until measured. */
  readonly motionMeasure?: CameraMotionMeasure;
  /** 0..1: how much happens (motion and change). */
  readonly energy: number;
  readonly onScreenText: readonly OnScreenText[];
  /** 64-bit dHash of the best frame, 16 hex digits. */
  readonly dHash: string;
  /** Model output: untrusted. Absent until described, or when no model may run. */
  readonly description?: ShotDescription;
  /** Why there is no description. */
  readonly descriptionSkipped?: (typeof DESCRIPTION_SKIPPED_REASONS)[number];
  /** Casting's curves and peaks. Absent for analyses stored before vision wrote them. */
  readonly signals?: ShotSignals;
}

export const shotDescriptionSchema: z.ZodType<ShotDescription> = z.object({
  text: z.string().max(300),
  objects: z.array(z.string().min(1).max(40)).max(12),
  place: z.string().max(80).optional(),
  shotType: z.enum(SHOT_TYPES).optional(),
  people: z.int().nonnegative().max(1000).optional(),
  actions: z.array(shotActionSchema).max(SHOT_ACTION_LIMITS.count).optional(),
  model: z.object({ provider: z.string().min(1), model: z.string().min(1), local: z.boolean() }),
});

export const shotAnalysisSchema: z.ZodType<ShotAnalysis> = z.object({
  version: z.literal(1),
  range: timeRangeSchema,
  bestFrame: z.int().nonnegative(),
  orientation: z.enum(ORIENTATIONS),
  quality: qualityScoresSchema,
  motion: z.enum(CAMERA_MOTIONS).optional(),
  motionMeasure: cameraMotionMeasureSchema.optional(),
  energy: unit,
  onScreenText: z.array(onScreenTextSchema).max(200),
  dHash: z.string().regex(/^[0-9a-f]{16}$/),
  description: shotDescriptionSchema.optional(),
  descriptionSkipped: z.enum(DESCRIPTION_SKIPPED_REASONS).optional(),
  signals: shotSignalsSchema.optional(),
});
