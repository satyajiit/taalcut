// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How a timeline's audio is mixed (P3-V6): music and effects duck under the voice by short-term loudness. Part of
 * Timeline v2 (`timeline.mix`); `music.setDucking` changes it, render's mixer reads it, audio's DuckingPlanner
 * plans the gain envelopes.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { RationalTime, rationalTimeSchema } from '../time/rational-time';
import type { FrameRate } from '../time/frame-rate';

export const duckingSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Voice above music, in LU of short-term loudness (8 is the plan's floor). */
  marginLu: z.number().min(6).max(20),
  floorDb: z.number().min(-40).max(-6),
  attackMs: z.int().min(10).max(500),
  releaseMs: z.int().min(50).max(2000),
});
export type DuckingSettings = z.output<typeof duckingSettingsSchema>;

export const DEFAULT_DUCKING: DuckingSettings = {
  enabled: true,
  marginLu: 8,
  floorDb: -30,
  attackMs: 80,
  releaseMs: 300,
};

/**
 * EDT1-OPS: where the music sounds on the timeline and how (`audio.setVolume`, `audio.trim`, `audio.move` on the
 * music). Times are at the canvas rate. The music sample under timeline time t is the one its path plays at
 * t − `shift` (path b's `offset` still names the track time under the path's frame 0), so a move changes `shift`
 * and the window together and a trim only the window. Absent: from frame 0 to the end, unmoved, no fades.
 */
export const musicBedSchema = z
  .object({
    /** Silence before it. */
    start: rationalTimeSchema,
    /** Silence after it; null plays to the video's end. */
    end: rationalTimeSchema.nullable(),
    /** Positive moves the music later. */
    shift: rationalTimeSchema,
    fadeIn: rationalTimeSchema,
    fadeOut: rationalTimeSchema,
    muted: z.boolean(),
  })
  .refine((bed) => bed.start.value >= 0 && bed.fadeIn.value >= 0 && bed.fadeOut.value >= 0, {
    message: 'Starts at frame 0 or later, with fades of zero or more',
  })
  .refine((bed) => bed.end === null || RationalTime.compare(bed.end, bed.start) > 0, {
    message: 'Ends after it starts',
  });
export type MusicBed = z.output<typeof musicBedSchema>;

/** The music as a timeline without a bed plays it: from frame 0 to the end. */
export function defaultMusicBed(rate: FrameRate): MusicBed {
  const zero = RationalTime.zero(rate);
  return { start: zero, end: null, shift: zero, fadeIn: zero, fadeOut: zero, muted: false };
}

export const timelineMixSchema = z.object({
  ducking: duckingSettingsSchema,
  music: musicBedSchema.optional(),
});
export type TimelineMix = z.output<typeof timelineMixSchema>;

/** A new timeline's mix, and what a Timeline v1 document upgrades to. */
export const DEFAULT_MIX: TimelineMix = { ducking: DEFAULT_DUCKING };

/** The kinds of sound effect `sfx.setHits` places on cuts. */
export const SFX_CATEGORIES = ['whoosh', 'riser', 'impact', 'hit'] as const;
export type SfxCategory = (typeof SFX_CATEGORIES)[number];
