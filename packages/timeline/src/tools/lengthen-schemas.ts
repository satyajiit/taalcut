// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: what `timeline.musicBars` and `timeline.lengthenSlot` take and answer (lengthen-tools.ts). The shapes are
 * length-facts.ts's, as schemas; every time is in seconds of the video unless its name says the shot or the reel.
 */
import { LENGTHEN_FOOTAGE, MAX_REPEAT_BARS, SLOT_EDGES, ulidSchema } from '@taalcut/core';
import { z } from 'zod';
import { clipRefSchema, readRevisionSchema } from './clip-refs';

const seconds = z.number();
const db = z.number().nullable();

export const lengthenStatementSchema = z.object({
  clip: clipRefSchema,
  bars: z.int().min(1).max(MAX_REPEAT_BARS).describe('Whole bars to add'),
  at: z
    .number()
    .min(0)
    .max(36_000)
    .describe(
      'A bar line (music.bars of timeline.musicBars), seconds of the video: the bars before it play again',
    ),
  footage: z
    .enum(LENGTHEN_FOOTAGE)
    .describe('The added footage: the shot before what the clip plays now, or after it'),
});

const target = { projectId: ulidSchema('Project'), timelineId: ulidSchema('Timeline') };

export const musicBarsInputSchema = z.object({
  ...target,
  would: lengthenStatementSchema
    .optional()
    .describe('A lengthening to try: answered in `would` or `cannot`, nothing changed'),
});

export const lengthenSlotInputSchema = z.object({
  ...target,
  revision: readRevisionSchema,
  ...lengthenStatementSchema.shape,
});

const clipLengthSchema = z.object({
  clip: z.int().min(0),
  clipId: z.string(),
  slot: z.int().min(1).nullable(),
  from: seconds,
  to: seconds,
  frames: z.int().min(1),
  reel: z.literal(true).optional(),
  longerBy: z.int().min(1).optional(),
  shot: z
    .object({
      from: seconds,
      to: seconds,
      playsFrom: seconds,
      playsTo: seconds,
      before: seconds,
      after: seconds,
    })
    .optional(),
  lands: z.object({ edge: z.enum(SLOT_EDGES), shotSeconds: seconds, videoSeconds: seconds }).optional(),
});

const wouldSchema = z.object({
  frames: z.int().min(1),
  seconds,
  barsSeconds: seconds,
  offMs: z.number(),
  video: z.object({ fromFrames: z.int(), toFrames: z.int(), toSeconds: seconds }),
  music: z.object({
    at: seconds,
    backTo: seconds,
    crossfadeMs: z.number(),
    seam: z.object({ apartDb: db, levelDb: db, overSeconds: seconds }),
  }),
  clip: clipLengthSchema,
  later: z.object({
    fromSeconds: seconds,
    clips: z.int(),
    reelClips: z.int(),
    transitions: z.int(),
    texts: z.int(),
    textsLonger: z.int(),
    captions: z.int(),
    sounds: z.int(),
    markers: z.int(),
  }),
});

export const musicBarsOutputSchema = z.object({
  timelineId: z.string(),
  revision: z.int(),
  video: z.object({ frames: z.int(), seconds, framesPerSecond: z.number() }),
  music: z.object({
    /** The video's music choice (render's path); bars are measured for the reel's own. */
    path: z.string(),
    measured: z.boolean(),
    why: z.string().optional(),
    reelSeconds: seconds.optional(),
    bpm: z.number().nullable().optional(),
    beatsPerBar: z.number().nullable().optional(),
    barSeconds: z.number().nullable().optional(),
    barFrames: z.number().nullable().optional(),
    sure: z
      .object({
        pulse: z.number(),
        onBeat: z.number(),
        bar: z.number(),
        meter: z.number(),
        firstBeat: z.number(),
      })
      .optional(),
    measuredAcrossBeats: z.number().optional(),
    bars: z.array(
      z.object({ at: seconds, levelDb: z.number(), fromBarBefore: db, again: z.literal(true).optional() }),
    ),
    changes: z.array(z.object({ at: seconds, levelDb: z.number(), bandsDb: z.number() })),
    repeats: z.array(
      z.object({ at: seconds, backTo: seconds, frames: z.int(), bars: z.int(), slot: z.int().nullable() }),
    ),
  }),
  clips: z.array(clipLengthSchema),
  reading: z.string(),
  would: wouldSchema.optional(),
  cannot: z.string().optional(),
});

export const lengthenSlotOutputSchema = z.object({
  timelineId: z.string(),
  revision: z.int(),
  affectedItemIds: z.array(z.string()),
  ...wouldSchema.shape,
});
