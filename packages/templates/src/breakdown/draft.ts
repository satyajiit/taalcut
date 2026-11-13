// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The breakdown's output (SPEC "Output"): everything the deterministic
 * pipeline found, before any judgement. Stored as the job's output and as
 * `breakdown.json` in the experiment; its `breakdownId` is the experiment's
 * id (one breakdown per experiment). Frame paths are relative to the
 * experiment and disappear with it: the template, its contact sheet and its
 * kept reel (REF1) outlive the breakdown.
 */
import {
  audioProfileSchema,
  beatMapSchema,
  canvasSchema,
  doubtsSchema,
  reelSubjectsSchema,
  frameRateSchema,
  languageTagSchema,
  rationalTimeSchema,
  REFERENCE_INPUTS,
  REFERENCE_PLATFORMS,
  sha256Schema,
  textOverlaySchema,
} from '@taalcut/core';
import { z } from 'zod';
import { draftCameraSchema } from './camera';
import { draftGraphicSheetSchema } from './graphic-sheets';
import { draftTextRegionSchema } from './text-judge';

export const BREAKDOWN_FILE = 'breakdown.json';

const frame = z.int().nonnegative();
const relativePath = z.string().min(1).max(512);
const transitionGuessSchema = z.object({
  kind: z.enum(['dissolve', 'fade', 'whip']),
  before: frame,
  after: frame,
  confidence: z.number().min(0).max(1),
});

export const cropSchema = z.object({
  x: z.int().nonnegative(),
  y: z.int().nonnegative(),
  width: z.int().positive(),
  height: z.int().positive(),
});

export const draftCutSchema = z.object({
  frame: z.int().positive(),
  method: z.enum(['both', 'scdet', 'embedding']),
  score: z.number().nullable(),
  distance: z.number().nullable(),
  transition: transitionGuessSchema.nullable(),
});

export const draftDisputeSchema = draftCutSchema.extend({
  ramp: z.object({ start: frame, end: frame }).nullable(),
  /** What the rule decides without a vision verdict. */
  ruleKeeps: z.boolean(),
  /** 512 px frames either side of the cut, for the Analyst (experiment-relative). */
  before: relativePath,
  after: relativePath,
});

export const breakdownDraftSchema = z.object({
  breakdownId: z.string().min(1).max(64),
  pipelineVersion: z.string().min(1).max(32),
  configVersion: z.string().min(1).max(64),
  fingerprint: sha256Schema,
  analysedAt: z.int().nonnegative(),
  reference: z.object({
    input: z.enum(REFERENCE_INPUTS),
    platform: z.enum(REFERENCE_PLATFORMS).nullable(),
    url: z.string().max(2048).nullable(),
    sound: z
      .object({ title: z.string().max(200).nullable(), artist: z.string().max(200).nullable() })
      .nullable(),
    source: z.object({
      duration: rationalTimeSchema,
      rate: frameRateSchema,
      width: z.int().positive(),
      height: z.int().positive(),
      /** REF1: whether the reel has sound, for its kept media. Absent from a draft made before REF1. */
      hasAudio: z.boolean().optional(),
    }),
    crop: cropSchema.nullable(),
  }),
  canvas: canvasSchema,
  duration: rationalTimeSchema,
  /** Confirmed cuts (both methods, or A alone when B had no frames and A was strong). */
  cuts: z.array(draftCutSchema).max(1000),
  disputes: z.array(draftDisputeSchema).max(1000),
  beatMap: beatMapSchema.nullable(),
  /** Overlays with exact frames; `slotId` is set when the slots are known. */
  text: z.array(textOverlaySchema).max(500),
  /**
   * FIX-SIGN: every reading's composited-or-scene record (text-judge.ts), dropped ones included. Absent before
   * FIX-SIGN.
   */
  textRegions: z.array(draftTextRegionSchema).max(500).optional(),
  audio: audioProfileSchema,
  language: languageTagSchema.nullable(),
  /** Speed ramps inside shots, frames from the shot's start (`start`, `end` absolute). */
  ramps: z
    .array(
      z.object({
        start: frame,
        end: frame,
        points: z
          .array(z.object({ at: frame, speed: z.number().min(0.1).max(16) }))
          .min(2)
          .max(16),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(200),
  /**
   * Provisional slots (confirmed cuts plus the rule's choices): first, middle and last frame at 512 px. BRK1:
   * `strip` is the first and last frame in one image, for the Analyst to see the shot move; absent before BRK1.
   */
  slotFrames: z
    .array(
      z.object({
        start: frame,
        end: frame,
        frames: z.array(relativePath).max(3),
        strip: relativePath.optional(),
        /** BRK1: the embedding distance between its first and last frames (one-shot.ts shotChange). */
        change: z.number().min(0).max(2).optional(),
        /** BRK1: how fast the camera moves through it, frame widths a second (one-shot.ts shotMotion). */
        motion: z.number().min(0).max(100).optional(),
      }),
    )
    .max(400),
  /**
   * FRM1-MOT: the camera's frame pairs between every candidate cut, measured (camera.ts); each slot's move is read
   * from the spans inside it. Absent without the estimator, or before FRM1.
   */
  camera: draftCameraSchema.optional(),
  /** DSG1-READ: each kept overlay's life in one picture, for its brief (graphic-sheets.ts); absent before DSG1. */
  graphicSheets: z.array(draftGraphicSheetSchema).max(32).optional(),
  /** The kept low-res sheet, one tile per provisional slot (its middle frame). */
  contactSheet: z
    .object({
      path: relativePath,
      bytes: z.int().positive(),
      mediaType: z.enum(['image/jpeg', 'image/webp']),
      columns: z.int().min(1).max(10),
      rows: z.int().min(1).max(10),
      tile: z.object({ width: z.int().min(16).max(180), height: z.int().min(16).max(180) }),
      frames: z.array(frame).max(60),
    })
    .nullable(),
  warnings: z.array(z.string().max(200)).max(50),
  /** BRK1: what the review should ask about the whole reel (doubts.ts); absent before BRK1. */
  doubts: doubtsSchema.optional(),
  /** FRM1-SUB: where people are in the reel over time (reel-subjects.ts); absent without a subject analyser. */
  subjects: reelSubjectsSchema.optional(),
});
export type BreakdownDraft = z.output<typeof breakdownDraftSchema>;
export type DraftCut = z.output<typeof draftCutSchema>;
export type DraftDispute = z.output<typeof draftDisputeSchema>;
