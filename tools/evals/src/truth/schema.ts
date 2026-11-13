// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A reel's truth file (BRK1-ACC): what a careful frame-level look at one reference reel found, for scoring a
 * breakdown's template against it (score.ts). Truth files for real reels stay outside the repo; the tests use
 * made-up ones. Frames are at `frameRate`; times in milliseconds.
 */
import { z } from 'zod';

const frame = z.int().min(0);
const box = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

export const truthSchema = z.object({
  reelId: z.string().min(1),
  frameRate: z.object({ numerator: z.int().min(1), denominator: z.int().min(1) }),
  source: z.object({
    durationFrames: frame,
    width: z.int().min(1),
    height: z.int().min(1),
    orientation: z.enum(['landscape', 'portrait', 'square']),
  }),
  /** The frames real shots start at (not 0). */
  cuts: z.array(frame),
  /** Frames a breakdown has put a cut on that are one shot. */
  notCuts: z
    .array(z.object({ frame: frame.optional(), frameRange: z.tuple([frame, frame]).optional() }))
    .default([]),
  transitions: z.array(z.object({ kind: z.string(), startFrame: frame, endFrame: frame })).default([]),
  shots: z.array(
    z.object({
      startFrame: frame,
      endFrame: frame,
      /** Words any of which names the shot's subject. */
      subjectWords: z.array(z.string()).min(1),
      /** Camera motions a fair description may give (`SlotIntent.motion` values). */
      cameraMotions: z.array(z.string()).min(1),
      static: z.boolean(),
    }),
  ),
  /**
   * The editor's overlays; every other reading is the scene's. DSG1-READ, optional: the graphic kinds a fair brief
   * may give (core's GRAPHIC_BRIEF_KINDS), its part in the story, and a message's sender.
   */
  overlays: z.array(
    z.object({
      text: z.string(),
      startFrame: frame,
      endFrame: frame,
      box,
      kinds: z.array(z.string()).min(1).optional(),
      role: z.string().optional(),
      speaker: z.enum(['me', 'them']).optional(),
    }),
  ),
  /** DSG1-READ: scene text that must never be read as a graphic (a station sign), by its words. */
  sceneText: z.array(z.object({ text: z.string().min(1) })).default([]),
  tempo: z.object({
    bpm: z.number().positive(),
    beatsPerBar: z.int().min(1),
    downbeatsMs: z.array(z.number()),
  }),
  speech: z.object({ present: z.boolean() }),
  expectedDoubts: z.object({ template: z.array(z.string()).default([]) }).default({ template: [] }),
});

export type Truth = z.infer<typeof truthSchema>;
