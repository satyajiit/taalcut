// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: a video that runs longer than its reel. A video made from a reel was exactly the reel's length, so a
 * person's clip with more to show than its slot had room for lost the rest. A slot can now be lengthened by whole
 * bars of the reel's music, and the music is carried by playing those bars again.
 *
 * - **A repeat** says where the reel's own music (render's path d) goes back and by how much. Until `at` it plays
 *   as it does in the reel; from `at` it plays again from `length` earlier, so `length` of it sounds twice and
 *   everything after sounds `length` later. A short crossfade that ends at `at` joins the two. `length` is whole
 *   frames at the canvas rate: the one number the picture after `at` is moved by too (the lengthened slot's clip
 *   took the frames), so a kept reel clip still sits on the music it sat on in the reel.
 * - **Kept on the mix** (`timeline.mix.musicRepeats`), not on the music choice: the picture stays longer however
 *   the video gets its music, so the repeats stay through a change of path and sound again when the reel's music
 *   does. Only the reel's own music plays them.
 * - **`timeline.lengthenSlot`** writes one (handler: @taalcut/timeline): the slot's clip `frames` longer, the
 *   repeat added, and everything from the splice on moved later by `frames`. It applies what it is given; that
 *   `frames` is whole bars and `at` a bar line is its caller's statement, checked against the measured bars by the
 *   tool of the same name. One undo step.
 *
 * Nothing here decides whether a video should be longer, which slot, by how many bars or where the music repeats.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, ulidSchema } from '../basics/ids';
import { RationalTime, rationalTimeSchema } from '../time/rational-time';

/** The most repeats one timeline carries. */
export const MAX_MUSIC_REPEATS = 16;
/** The most bars one repeat plays again. */
export const MAX_REPEAT_BARS = 64;

export const musicRepeatSchema = z
  .object({
    /**
     * Where the music goes back, on the music's own clock on this timeline: zero is the reel's first sample (so
     * before the music bed's `shift`), counted with the repeats before this one. A bar line of the music, so at
     * any rate: a sample time, not a frame.
     */
    at: rationalTimeSchema,
    /** How far back it goes: whole frames at the canvas rate, the same number the picture after it is moved by. */
    length: rationalTimeSchema,
    /** The crossfade from the music before into the bars played again; it ends at `at`. Zero is a plain cut. */
    crossfade: rationalTimeSchema,
    /** How many whole bars `length` is, by the measurement it was made from. */
    bars: z.int().min(1).max(MAX_REPEAT_BARS),
    /** The template slot whose clip took the frames; null when its clip filled no slot. */
    slotId: idSchema<'TemplateSlot'>().nullable(),
  })
  .refine((repeat) => repeat.at.value > 0 && repeat.length.value >= 1 && repeat.crossfade.value >= 0, {
    message: 'Goes back at least one frame, after the start, with a crossfade of zero or more',
  });
export type MusicRepeat = z.output<typeof musicRepeatSchema>;

/**
 * A timeline's repeats: in time order, each after the one before, and each with the music it plays again (and its
 * crossfade) inside the reel: `at`, less every length up to and including its own, is the reel time it goes back
 * to, never before the reel's first sample.
 */
export const musicRepeatsSchema = z
  .array(musicRepeatSchema)
  .max(MAX_MUSIC_REPEATS)
  .superRefine((repeats, ctx) => {
    let back: RationalTime | null = null;
    let previous: RationalTime | null = null;
    repeats.forEach((repeat, index) => {
      if (previous && RationalTime.compare(repeat.at, previous) <= 0)
        ctx.addIssue({ code: 'custom', path: [index, 'at'], message: 'Repeats are in order' });
      previous = repeat.at;
      back = back ? RationalTime.add(back, repeat.length) : repeat.length;
      if (RationalTime.compare(repeat.at, RationalTime.add(back, repeat.crossfade)) < 0)
        ctx.addIssue({
          code: 'custom',
          path: [index, 'length'],
          message: 'The music goes back to before its first sample',
        });
    });
  });

/** Which side of what the clip plays now the added frames show: the shot's footage before it, or after it. */
export const LENGTHEN_FOOTAGE = ['before', 'after'] as const;
export type LengthenFootage = (typeof LENGTHEN_FOOTAGE)[number];

/** The longest one call lengthens a slot by, in frames (ten minutes at 60 frames a second). */
export const MAX_LENGTHEN_FRAMES = 36_000;

export const LENGTHEN_SLOT_COMMAND = 'timeline.lengthenSlot';
export const lengthenSlotPayloadSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive().optional(),
  /** The clip that fills the slot. */
  clipId: ulidSchema('TimelineItem'),
  /** Whole frames added: the one number for the picture and the sound. */
  frames: z.int().min(1).max(MAX_LENGTHEN_FRAMES),
  /** How many bars of the music `frames` is. */
  bars: z.int().min(1).max(MAX_REPEAT_BARS),
  /** Where the music goes back: `musicRepeatSchema.at`. */
  at: rationalTimeSchema,
  /** `musicRepeatSchema.crossfade`. */
  crossfade: rationalTimeSchema,
  footage: z.enum(LENGTHEN_FOOTAGE),
});
export type LengthenSlotPayload = z.output<typeof lengthenSlotPayloadSchema>;

export const lengthenSlotResultSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  affectedItemIds: z.array(z.string()),
  /** The frames the video is longer by. */
  frames: z.int().min(0),
});
export type LengthenSlotResult = z.output<typeof lengthenSlotResultSchema>;
