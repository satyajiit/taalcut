// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the editor tools' inputs as the model writes them. Times are seconds (numbers), named so, which a small
 * model gets right more often than frame counts at a rate; editor-payloads.ts turns them into core's payloads, whose
 * commands land each on the nearest frame. Ids are ULID strings, as in json.ts.
 */
import {
  CLIP_EDGES,
  DELETE_MODES,
  DIRECTIONS,
  DRAWN_TRANSITION_KINDS,
  GRADE_LOOKS,
  MARKER_COLOURS,
  MARKER_KINDS,
  SLIP_AVOIDS,
  SPEED_AUDIO,
  SPEED_FITS,
  STILL_MOTIONS,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import { clipRefSchema, clipRefsSchema, readRevisionSchema } from './clip-refs';

const target = {
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: readRevisionSchema,
};
const itemId = ulidSchema('TimelineItem');
const seconds = (what: string) => z.number().min(0).max(3600).describe(what);
const signedSeconds = (what: string) => z.number().min(-3600).max(3600).describe(what);
const speed = z.number().min(0.1).max(16);
const exactlyOne = (fields: readonly string[]) => (value: Record<string, unknown>) =>
  fields.filter((field) => value[field] !== undefined).length === 1;
/**
 * EDT1-OPS: the clip, required: its number or "this" (clip-refs.ts), or an id. It replaced `clipId`: with both
 * optional the 9B sent neither. `revision` is the one the numbers were read at.
 */
const oneClip = (what?: string) => ({
  clip: what ? clipRefSchema.describe(what) : clipRefSchema,
  revision: readRevisionSchema,
});

/** The sounds a level change can take whole. */
export const SOUND_NAMES = ['music', 'voice', 'effects'] as const;

export const editorInputs = {
  'timeline.splitClip': z.object({
    ...target,
    ...oneClip(),
    atSeconds: seconds('Where to split, in seconds from the start of the video; inside the clip'),
    snapToBeat: z.boolean().optional().describe('Move the split to the nearest beat inside the clip'),
  }),
  'timeline.deleteClip': z.object({
    ...target,
    ...oneClip(),
    mode: z
      .enum(DELETE_MODES)
      .optional()
      .describe('ripple (default): what follows closes up; lift: a gap stays'),
  }),
  'timeline.insertClip': z.object({
    ...target,
    media: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('video'),
        assetId: ulidSchema('Asset'),
        shotId: ulidSchema('Shot').nullable(),
        inPointSeconds: seconds('Where in the shot’s file to start; absent picks a good moment').optional(),
      }),
      z.object({
        kind: z.literal('image'),
        assetId: ulidSchema('Asset'),
        stillMotion: z.enum(STILL_MOTIONS).optional(),
      }),
    ]),
    position: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('time'),
        atSeconds: seconds('From the start of the video; inside a clip it splits it'),
      }),
      z.object({ kind: z.literal('before'), clip: clipRefSchema }),
      z.object({ kind: z.literal('after'), clip: clipRefSchema }),
      z.object({ kind: z.literal('slot'), slotId: ulidSchema('TemplateSlot') }),
    ]),
    durationSeconds: z
      .number()
      .positive()
      .max(3600)
      .optional()
      .describe('Its length; absent: a typical clip’s'),
    revision: readRevisionSchema,
  }),
  'timeline.duplicateClip': z.object({ ...target, ...oneClip() }),
  'timeline.setSpeed': z
    .object({
      ...target,
      ...oneClip(),
      speed: speed.optional().describe('Constant speed: 0.5 is half speed, 2 double, 1 back to normal'),
      ramp: z
        .object({
          points: z
            .array(
              z.object({ at: z.number().min(0).max(1).describe('Share of the clip: 0 start, 1 end'), speed }),
            )
            .min(2)
            .max(16),
          curve: z.enum(['linear', 'ease', 'hold']),
        })
        .optional()
        .describe('A speed ramp instead of a constant speed; the first point at 0'),
      fit: z
        .enum(SPEED_FITS)
        .optional()
        .describe(
          'media (default): the clip shows the same moment, so it gets longer or shorter; length: it keeps its length',
        ),
      audio: z.enum(SPEED_AUDIO).optional().describe('Its own sound: absent mutes it only outside 0.5–2×'),
    })
    .refine(exactlyOne(['speed', 'ramp']), { message: 'Give speed or ramp' }),
  'timeline.setTransition': z.object({
    ...target,
    ...oneClip(
      'The earlier of the two clips by its number, or "this" ("into the next one" is "this" with edge end); at a cut "here", here.cut.beforeClip',
    ),
    edge: z
      .enum(CLIP_EDGES)
      .optional()
      .describe('end (default): into the next clip; start: from the one before'),
    kind: z
      .enum(DRAWN_TRANSITION_KINDS)
      .describe('dissolve = crossfade; fade = dip to black; flash = through white; whip, zoom, slide'),
    // EDT1-OPS: no null in a choice's schema: on the 9B a nullable enum came back as a quoted string ("\"mono\"").
    direction: z.enum(DIRECTIONS).optional().describe('slide: where it comes from; zoom: down zooms out'),
    durationSeconds: z
      .number()
      .positive()
      .max(5)
      .optional()
      .describe('Whole length; absent 0.5 (a whip 0.25)'),
  }),
  'timeline.removeTransition': z
    .object({
      ...target,
      transitionId: itemId.optional(),
      clip: clipRefSchema
        .describe('Or the clip (its number, or "this"), and the edge its transition is on')
        .optional(),
      revision: readRevisionSchema,
      edge: z.enum(CLIP_EDGES).optional(),
    })
    // EDT1-OPS: neither is the video's only transition (editor-tools.ts); the 9B left both out of "take the crossfade
    // out".
    .refine((input) => input.transitionId === undefined || input.clip === undefined, {
      message: 'Give transitionId or the clip, not both',
    }),
  'timeline.setGrade': z.object({
    ...target,
    clips: clipRefsSchema
      .describe(
        'The clips by their numbers ([3, 4]), or ["this"]: what the person pointed at, a selected stretch being every clip in it. Absent only for the whole video',
      )
      .optional(),
    revision: readRevisionSchema,
    wholeVideo: z
      .boolean()
      .optional()
      .describe(
        'true only when the words ask for the whole video ("the whole video", "everything"); then no clips',
      ),
    exposure: z.number().min(-2).max(2).optional().describe('Stops: +1 twice as bright'),
    highlights: z
      .number()
      .min(-1)
      .max(1)
      .optional()
      .describe(
        'Negative softens bright lights while preserving shadows and midtones; positive lifts highlights',
      ),
    whites: z
      .number()
      .min(-1)
      .max(1)
      .optional()
      .describe(
        'Negative lowers the brightest whites; positive lifts them. Cannot recover detail already clipped',
      ),
    contrast: z.number().min(-1).max(1).optional(),
    saturation: z.number().min(-1).max(1).optional().describe('-1 black and white, +1 twice the colour'),
    temperature: z.number().min(-1).max(1).optional().describe('-1 cool (blue), +1 warm (orange)'),
    tint: z.number().min(-1).max(1).optional().describe('-1 green, +1 magenta'),
    look: z
      .enum([...GRADE_LOOKS, 'none'])
      .optional()
      .describe('mono is black and white; none takes the look off'),
    lookStrength: z.number().min(0).max(1).optional(),
    reset: z.boolean().optional().describe('Take the grade off first: the fields given are then all it has'),
  }),
  'timeline.addMarker': z.object({
    ...target,
    atSeconds: seconds('From the start of the video'),
    durationSeconds: seconds('Absent: one instant').optional(),
    kind: z.enum(MARKER_KINDS).optional(),
    label: z.string().trim().max(120).optional(),
    colour: z.enum(MARKER_COLOURS).optional(),
  }),
  // FIX-TRIM: one form per field for the 9B's grammar, as a trim's `by`: seconds, or what to keep out, never two
  // optional fields side by side (eval run 13's malformed calls).
  'timeline.slipClip': z.object({
    ...target,
    ...oneClip(),
    part: z
      .xor([
        z.strictObject({
          seconds: z
            .number()
            .min(-600)
            .max(600)
            .describe(
              'Signed seconds in its shot: 1.5 plays from 1.5 s later in the shot, -1 from a second earlier',
            ),
        }),
        z.strictObject({
          avoid: z
            .array(z.enum(SLIP_AVOIDS))
            .min(1)
            .max(SLIP_AVOIDS.length)
            .describe(
              'What the clip should not show: "start" (someone only getting going, or the recording just starting), "end" (them slowing to a stop), "face"',
            ),
        }),
      ])
      .describe(
        'Which part of its shot: later or earlier by seconds, or one without what it should not show',
      ),
  }),
  // EDT1-OPS: whose sound is a required choice, so a call can't leave it out; "original" (every clip's own sound) is
  // gone: the 9B took it for one clip's sound ("turn the waves down"). Every clip is their clipIds, with wholeVideo.
  'audio.setVolume': z.object({
    ...target,
    of: z
      .discriminatedUnion('kind', [
        z.object({
          kind: z.literal('clips'),
          clips: clipRefsSchema.describe(
            'Video clips’ own sound by their numbers (“the waves” is the clip whose shows has waves), or ["this"]; a voice line or an effect by its id',
          ),
        }),
        z.object({
          kind: z.literal('sound'),
          sound: z.enum(SOUND_NAMES).describe('All of the music, every voice line, or every effect'),
        }),
      ])
      .describe('Whose sound: some clips, or a whole sound'),
    gainDb: z
      .number()
      .min(-60)
      .max(12)
      .optional()
      .describe('The level in dB: 0 as recorded, -6 about half as loud'),
    changeDb: z.number().min(-72).max(72).optional().describe('Or a change to the level, in dB'),
    muted: z.boolean().optional(),
    fadeInSeconds: seconds('0 takes the fade off').optional(),
    fadeOutSeconds: seconds('0 takes the fade off').optional(),
    wholeVideo: z
      .boolean()
      .optional()
      .describe('true only when the words ask for every clip’s sound ("all the clips", "everything")'),
    revision: readRevisionSchema,
  }),
  'audio.trim': z
    .object({
      ...target,
      clipId: itemId.optional().describe('A voice line or an effect'),
      sound: z.literal('music').optional(),
      edge: z.enum(CLIP_EDGES),
      bySeconds: signedSeconds('Positive lengthens at that edge, negative shortens'),
    })
    .refine(exactlyOne(['clipId', 'sound']), { message: 'Give clipId or sound' }),
  'audio.move': z
    .object({
      ...target,
      clipId: itemId.optional().describe('A voice line or an effect'),
      sound: z.literal('music').optional(),
      bySeconds: signedSeconds('Positive is later'),
    })
    .refine(exactlyOne(['clipId', 'sound']), { message: 'Give clipId or sound' }),
} as const;

export type EditorToolName = keyof typeof editorInputs;
export type EditorInput<N extends EditorToolName> = z.output<(typeof editorInputs)[N]>;

export const madeToolOutputSchema = z.object({
  affectedItemIds: z.array(z.string()).default([]),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().min(1),
  /** The item the edit made: a split's second half, an inserted or duplicated clip, a transition, a marker. */
  itemId: ulidSchema('TimelineItem').optional(),
});
