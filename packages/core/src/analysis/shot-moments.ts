// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: what a shot shows over time. Vision's describe stage splits a shot into consecutive stretches ("moments"),
 * each with a plain note of what the camera shows in it, in the model's own words (a stretch that shows nothing in
 * particular says so). They are stored with the shot's description (`ShotDescription.moments`), cover the shot from
 * its first frame to its last with no gap or overlap, and are model output from the user's media: untrusted data.
 *
 * Times are frames from the shot's start on the asset's grid, like `ShotAnalysis.bestFrame`. Nothing here knows what
 * a note is about: casting, the tools and QA compare notes with what a slot states, never with words in code.
 *
 * MOM2: a stretch may be `handling`: the describer's own statement, from the frames in order, that the camera is not
 * held on anything on purpose there but is being handled (raised, lowered, swung away, covered, put down, a take
 * starting or stopping). It is stated by the model, never worked out from a note's words; casting, the tools and QA
 * keep a clip off such a stretch. Absent means held on purpose, so a row written before MOM2 reads as it did.
 */
import '../basics/zod-config';
import { z } from 'zod';

/** One stretch of a shot: [start, end) in frames from the shot's start, and what the camera shows in it. */
export interface ShotMoment {
  readonly start: number;
  readonly end: number;
  readonly note: string;
  /** MOM2: the describer states the camera is being handled here, not filming on purpose. Absent otherwise. */
  readonly handling?: true;
}

/** Caps on a shot's moments: how many, and how long a note may be. */
export const SHOT_MOMENT_LIMITS = { count: 12, chars: 160 } as const;

export const shotMomentSchema: z.ZodType<ShotMoment> = z
  .object({
    start: z.int().nonnegative(),
    end: z.int().positive(),
    note: z.string().min(1).max(SHOT_MOMENT_LIMITS.chars),
    handling: z.literal(true).optional(),
  })
  .refine((moment) => moment.end > moment.start, { message: 'a moment ends after it starts' });

/** A shot's moments as stored: in order, each starting where the last ended. */
export const shotMomentsSchema: z.ZodType<readonly ShotMoment[]> = z
  .array(shotMomentSchema)
  .min(1)
  .max(SHOT_MOMENT_LIMITS.count)
  .refine(
    (moments) => moments.every((moment, index) => index === 0 || moment.start === moments[index - 1]!.end),
    {
      message: 'moments are consecutive',
    },
  );

/** The moments that overlap [from, to), in frames from the shot's start, in order. */
export function momentsDuring<M extends Pick<ShotMoment, 'start' | 'end'>>(
  moments: readonly M[],
  from: number,
  to: number,
): M[] {
  return moments.filter((moment) => moment.start < to && moment.end > from);
}

/** MOM2: how many frames of [from, to), in frames from the shot's start, lie in stretches stated as handling. */
export function handlingDuring(
  moments: readonly Pick<ShotMoment, 'start' | 'end' | 'handling'>[],
  from: number,
  to: number,
): number {
  let frames = 0;
  for (const moment of moments)
    if (moment.handling) frames += Math.max(0, Math.min(to, moment.end) - Math.max(from, moment.start));
  return frames;
}

/** MOM2: what a handling stretch is marked with wherever moments are put in words for a model. */
export const HANDLING_MARK = '(camera handling)';

export interface MomentWords {
  /** Frames per second of the grid the moments are on. */
  readonly fps: number;
  /** Seconds added to every time: the shot's start in its recording, so the times read as `playsShotFrom` does. */
  readonly offsetSeconds?: number;
  /** At most this many moments (the rest are counted); default all. */
  readonly count?: number;
  /** Each note cut to this; default the stored length. */
  readonly chars?: number;
}

const tenth = (seconds: number) => String(Math.round(seconds * 10) / 10);

/**
 * Moments in one line a model reads: `0-3.2s: a group holds up tickets; 3.2-4.8s (camera handling): the camera
 * tilts to the floor`, times in seconds of the recording to a tenth, a stretch stated as handling marked so (MOM2).
 * One string per shot, so the times stay beside their notes when an agent lifts untrusted text out of a tool's JSON.
 * Empty for no moments.
 */
export function momentsInWords(moments: readonly ShotMoment[], options: MomentWords): string {
  const fps = options.fps > 0 ? options.fps : 1;
  const offset = options.offsetSeconds ?? 0;
  const shown = moments.slice(0, options.count ?? moments.length);
  const cut = (note: string) =>
    options.chars !== undefined && note.length > options.chars
      ? `${note.slice(0, Math.max(1, options.chars - 1)).trimEnd()}…`
      : note;
  const parts = shown.map(
    (moment) =>
      `${tenth(offset + moment.start / fps)}-${tenth(offset + moment.end / fps)}s` +
      `${moment.handling ? ` ${HANDLING_MARK}` : ''}: ${cut(moment.note)}`,
  );
  const rest = moments.length - shown.length;
  if (rest > 0) parts.push(`+${rest} more`);
  return parts.join('; ');
}
