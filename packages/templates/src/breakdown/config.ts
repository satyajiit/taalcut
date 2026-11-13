// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Breakdown thresholds (SPEC "Config and evals"), versioned with the file
 * config/breakdown.v3.json and tuned against the golden set by tools/evals,
 * never by hand in code. The starting values follow the vision lane's design
 * and the FFmpeg research note (scdet low for recall, embeddings to confirm).
 */
import { z } from 'zod';
import { SCENE_SIGNALS } from './text-signals';
import breakdownV3 from '../../config/breakdown.v3.json' with { type: 'json' };

const unit = z.number().min(0).max(1);
const positive = z.number().positive();

export const breakdownConfigSchema = z.object({
  version: z.string().min(1).max(64),
  reference: z.object({ maxSeconds: positive, canvasWidth: z.int().min(16).max(8192) }),
  /** scdet scores (0–100): proposals at `propose` and above; `strong` keeps a cut by rule alone. */
  scdet: z.object({ threshold: positive, propose: positive, strong: positive, peakWindow: z.int().min(0) }),
  /** Cosine distances between frame embeddings (method B). */
  embed: z.object({
    confirm: unit,
    reject: unit,
    soft: unit,
    strong: unit,
    scanFps: positive,
    /** Frames each side of a proposal that are averaged. */
    context: z.int().min(1).max(10),
    rampLow: unit,
    rampHigh: unit,
  }),
  flash: z.object({ minFrames: z.int().min(1) }),
  text: z.object({
    ocrFps: positive,
    similarity: unit,
    iou: unit,
    minConfidence: unit,
    maxGapSamples: z.int().min(0),
    chromeShare: unit,
    languages: z.array(z.string().min(2)).min(1),
  }),
  beats: z.object({ minConfidence: unit, anchorFrames: z.int().min(0) }),
  transition: z.object({ keep: unit, fadeLuma: unit, flashLuma: unit, whipMotion: positive }),
  ramp: z.object({
    minRatio: positive,
    windowSeconds: positive,
    confirmRatio: positive,
    minSlotSeconds: positive,
  }),
  audio: z.object({
    silentLufs: z.number(),
    musicBeatConfidence: unit,
    musicMaxSpeech: unit,
    voiceMinSpeech: unit,
  }),
  /** BRK1: a soft cut whose ramp is one shot drifting (one-shot.ts). */
  soft: z.object({
    /** Fewer steady frames than this either side: the ramp fills its shot. */
    minPlateau: z.int().min(1),
    /** A transition's embedding moves at least this many times as fast as its shot does just before or after it. */
    bump: positive,
  }),
  /** BRK1: a cut inside a fade to black (one-shot.ts): darker than `luma` at the end, never brightening by `rise`. */
  fadeTail: z.object({ luma: unit, rise: unit }),
  /** BRK1: on-screen text that is part of the scene, not an overlay (text-scene.ts). */
  textScene: z.object({
    /** An overlay persists at least this long, unless it crosses a cut. */
    minSeconds: positive,
    /** A box this close to the frame's edge is cut off by it: a sign, not a layout. */
    edgeMargin: unit,
    /** The box's centre moving more than this share of its height across its samples moves with the scene. */
    maxDrift: positive,
    /** Starting or ending within this many frames of its shot's cut, the text lives and dies with the shot. */
    shotEdgeFrames: z.int().min(0),
    /** A box this many times taller than wide is vertical lettering on a sign. */
    verticalRatio: positive,
    /**
     * FIX-SIGN: the fused score (log-odds that a reading is the scene's, text-scene.ts) at or above `sceneLine` is
     * the scene's, at or below `addedLine` composited; between, unsure.
     */
    sceneLine: z.number(),
    addedLine: z.number(),
    /** Each signal's weight, in log-odds toward the scene (negative: toward composited). */
    weights: z.object(
      Object.fromEntries(SCENE_SIGNALS.map((signal) => [signal, z.number()])) as Record<
        (typeof SCENE_SIGNALS)[number],
        z.ZodNumber
      >,
    ),
  }),
  /** BRK1: the speech gate on Whisper's segments (speech-gate.ts). */
  speech: z.object({
    /** Mean word probability under this is rejected, when the engine gives it. */
    minConfidence: unit,
    /** A segment voice activity covers less of than this is rejected, when voice activity is known. */
    minVoiceShare: unit,
    /** The same words this many times in a row is Whisper looping. */
    repeats: z.int().min(2),
  }),
  /** BRK1: when a tempo may be half or double (doubts.ts). */
  tempo: z.object({
    /** Onset strength between the beats at least this share of on them: double time is as likely. */
    halfBeatRatio: unit,
    /** At or above this the tempo may be double the felt one; at or below `slowBpm`, half. */
    fastBpm: positive,
    slowBpm: positive,
  }),
  /** BRK1: what the review asks about (doubts.ts). */
  doubts: z.object({
    /** A cut under this confidence is unsure. */
    cutConfidence: unit,
    /** A slot this short after a fade is maybe its tail. */
    fadeTailSeconds: positive,
    /** An intent with fewer words than this is vague. */
    minIntentWords: z.int().min(1),
  }),
  /**
   * BRK1: a shot moves when the camera moves through it at `motion` frame widths a second or more (vision's motion
   * curve, one-shot.ts shotMotion), or, with no curve, when its picture travels at least `change` (embedding distance,
   * first frame to last). FRM1-MOT: only for a draft without a measured camera (camera.ts), to word the strip's
   * question (looks.ts).
   */
  moves: z.object({ motion: z.number().min(0).max(100), change: unit }),
  contactSheet: z.object({
    maxTiles: z.int().min(1).max(100),
    tileLongSide: z.int().min(16).max(180),
    quality: z.int().min(1).max(100),
    maxColumns: z.int().min(1).max(10),
    workingFrame: z.int().min(64).max(2048),
  }),
});
export type BreakdownConfig = z.output<typeof breakdownConfigSchema>;

export const BREAKDOWN_CONFIG: BreakdownConfig = breakdownConfigSchema.parse(breakdownV3);

/** Bumped when the pipeline's code changes what it finds (with the same config). */
// 3 (FRM1-MOT): the camera's move is measured between every candidate cut (draft.camera).
// 4 (FIX-SIGN): text is judged composited or scene from fused evidence (text-scene.ts).
// 5 (DSG1-READ): each kept overlay's life drawn for its brief (draft.graphicSheets).
export const BREAKDOWN_PIPELINE_VERSION = '5';
