// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the editor's full set of edits (plan/editor-round-1.md, lane ops): split, delete, insert and duplicate
 * a clip, speed, transitions, colour, markers, and the sound's level, fades, trims and moves. Handlers:
 * @taalcut/timeline, the `audio.*` edits too (they change the timeline document and nothing else). All are write
 * and undoable; each inverse is `timeline.restore` with the parts the edit changed, so one ⌘Z undoes the edit and
 * its beat re-sync together. Results are `editorCommandResultSchema`: `{ timelineId, revision }`, and `itemId` when
 * the edit made an item (a split's second half, an inserted or duplicated clip, a marker). An edit that changes
 * nothing writes nothing.
 *
 * FIX-TRIM adds `timeline.slipClip`: a clip plays a later or earlier part of its shot, keeping its id, its place and
 * its length; by a time, to an in-point, or away from what it should not show (`avoid`).
 *
 * Times are RationalTime: timeline times and lengths at any rate, landing on the nearest canvas frame; a video's
 * in-point (`sourceStart`) at the media's rate.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { rationalTimeSchema } from '../time/rational-time';
import { DIRECTIONS } from '../templates/template-parts';
import { gradePatchSchema } from './grade';
import { MARKER_COLOURS, MARKER_KINDS, STILL_MOTIONS } from './timeline-items';

export const EDITOR_COMMANDS = {
  /** A clip becomes two at a time inside it; the second half is a new clip. */
  splitClip: 'timeline.splitClip',
  /** A clip (or gap) goes: the rest closes up (ripple), or a gap keeps its place (lift). */
  deleteClip: 'timeline.deleteClip',
  /** A library shot or photo goes in at a time, beside an item, or before a slot; the rest moves later. */
  insertClip: 'timeline.insertClip',
  /** A copy of a clip right after it; the rest moves later. */
  duplicateClip: 'timeline.duplicateClip',
  /** A clip's speed: constant, a ramp, or back to normal. */
  setSpeed: 'timeline.setSpeed',
  /** The transition on one edge of a clip: added, or replaced when there is one. */
  setTransition: 'timeline.setTransition',
  removeTransition: 'timeline.removeTransition',
  /** Colour on clips or the whole video. */
  setGrade: 'timeline.setGrade',
  addMarker: 'timeline.addMarker',
  /** FIX-TRIM: a later or earlier part of the clip's shot, its place and length kept. */
  slipClip: 'timeline.slipClip',
} as const;

export const AUDIO_EDIT_COMMANDS = {
  /** Level, mute and fades: of clips' sound (the video's own, voice lines, effects) or the music. */
  setVolume: 'audio.setVolume',
  /** One edge of the music, a voice line or an effect, its sound staying where it was in time. */
  trim: 'audio.trim',
  /** The music, a voice line or an effect, later or earlier. */
  move: 'audio.move',
} as const;

/** Which end of a clip: a transition's or a trim's. */
export const CLIP_EDGES = ['start', 'end'] as const;
export type ClipEdge = (typeof CLIP_EDGES)[number];

/**
 * FIX-TRIM: what a slip keeps out of the clip. `start`: the shot's start (the recording's first second, the person
 * only getting going); `end`: its end (them slowing to a stop, the recording's last half second); `face`: a face.
 */
export const SLIP_AVOIDS = ['start', 'end', 'face'] as const;
export type SlipAvoid = (typeof SLIP_AVOIDS)[number];

/** `ripple`: what follows closes up; `lift`: a gap of the same length stays. */
export const DELETE_MODES = ['ripple', 'lift'] as const;

/**
 * How a new speed fits: `media` keeps what the clip shows, so its length changes and what follows moves (as an
 * editor's speed change does); `length` keeps its place and length, showing more or less of its media.
 */
export const SPEED_FITS = ['media', 'length'] as const;

/**
 * The clip's own sound at a new speed. `keepPitch`: it plays at the speed with its pitch kept (render's tempo
 * filters, never resampling). `mute`: it is muted (`audio.muted`, so it can be turned back on). Absent: keepPitch
 * while every speed of the clip is in SPEED_KEEPS_PITCH, else mute; a clip back at normal speed keeps its mute.
 */
export const SPEED_AUDIO = ['keepPitch', 'mute'] as const;
/** The speeds whose sound still reads as itself: outside them an unasked speed change mutes the clip. */
export const SPEED_KEEPS_PITCH = { min: 0.5, max: 2 } as const;
/** As a template's speed ramps: 0.1× to 16×. */
export const SPEED_BOUNDS = { min: 0.1, max: 16 } as const;

/**
 * The transition kinds render draws (core TRANSITION_KINDS without glitch and other, which render draws as cuts):
 * dissolve is a crossfade, fade dips to black, flash goes through white, whip pans with a blur (`direction`
 * left or right), zoom zooms in (`direction` 'down' zooms out), slide pushes the next clip in from `direction`.
 */
export const DRAWN_TRANSITION_KINDS = ['dissolve', 'fade', 'whip', 'zoom', 'slide', 'flash'] as const;
export type DrawnTransitionKind = (typeof DRAWN_TRANSITION_KINDS)[number];

/**
 * Sound groups an edit can take whole: `clips` is the video's own sound (V1's clips and audio tracks of role
 * 'clip'), `voice` the voice track's lines, `sfx` the effects track's.
 */
export const AUDIO_GROUPS = ['clips', 'voice', 'sfx'] as const;
export type AudioGroup = (typeof AUDIO_GROUPS)[number];

const projectId = idSchema<'Project'>();
const target = { projectId, timelineId: idSchema<'Timeline'>(), revision: z.int().positive().optional() };
const itemId = idSchema<'TimelineItem'>();
const time = rationalTimeSchema;
const speed = z.number().min(SPEED_BOUNDS.min).max(SPEED_BOUNDS.max);
const clipIds = z.array(itemId).min(1).max(60);

/** Where an inserted clip goes. */
export const insertPositionSchema = z.discriminatedUnion('kind', [
  /** At this timeline time: inside a clip it splits the clip there; on a cut it goes between. */
  z.object({ kind: z.literal('time'), at: time }),
  z.object({ kind: z.literal('before'), itemId }),
  z.object({ kind: z.literal('after'), itemId }),
  /** Before the clip or gap that fills this template slot. */
  z.object({ kind: z.literal('slot'), slotId: idSchema<'TemplateSlot'>() }),
]);
export type InsertPosition = z.output<typeof insertPositionSchema>;

/** What an inserted clip plays: one shot of a library video from an in-point, or a photo. */
export const insertMediaSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('video'),
    assetId: idSchema<'Asset'>(),
    shotId: idSchema<'Shot'>().nullable(),
    /** At the media's rate. Absent: the in-point rule's (a motion peak on the beat), else the shot's start. */
    sourceStart: time.optional(),
  }),
  z.object({
    kind: z.literal('image'),
    assetId: idSchema<'Asset'>(),
    stillMotion: z.enum(STILL_MOTIONS).default('pushIn'),
  }),
]);

/** A clip's new speed. */
export const speedChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('normal') }),
  z.object({ kind: z.literal('constant'), speed }),
  z.object({
    kind: z.literal('ramp'),
    /** `at` is a share of the clip, 0 its start and 1 its end: the first 0, then increasing. */
    points: z
      .array(z.object({ at: z.number().min(0).max(1), speed }))
      .min(2)
      .max(16)
      .refine(
        (points) => points[0]?.at === 0 && points.every((p, i) => i === 0 || p.at > (points[i - 1]?.at ?? 1)),
        {
          message: 'The first point is at 0 and each later one further on',
        },
      ),
    curve: z.enum(['linear', 'ease', 'hold']),
  }),
]);
export type SpeedChange = z.output<typeof speedChangeSchema>;

export const gradeTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clips'), clipIds }),
  z.object({ kind: z.literal('timeline') }),
]);
export type GradeTarget = z.output<typeof gradeTargetSchema>;

/** Whose sound a level or fade change takes. */
export const audioTargetSchema = z.discriminatedUnion('kind', [
  /** Clips on any track: a V1 clip's own sound, a voice line, an effect. */
  z.object({ kind: z.literal('clips'), clipIds }),
  z.object({ kind: z.literal('music') }),
  z.object({ kind: z.literal('all'), group: z.enum(AUDIO_GROUPS) }),
]);
export type AudioTarget = z.output<typeof audioTargetSchema>;

/** What a trim or move takes: one clip on an audio track (a voice line, an effect), or the music. */
export const audioItemTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('clip'), clipId: itemId }),
  z.object({ kind: z.literal('music') }),
]);
export type AudioItemTarget = z.output<typeof audioItemTargetSchema>;

const nonNegative = (field: string) =>
  time.refine((value) => value.value >= 0, { message: `${field} is zero or more` });

export const editorCommandPayloads = {
  [EDITOR_COMMANDS.splitClip]: z.object({
    ...target,
    clipId: itemId,
    /** Timeline time, strictly inside the clip. */
    at: time,
    /** Moves the split to the nearest beat (or half beat) inside the clip; absent stays at `at`. */
    snapToBeat: z.boolean().default(false),
  }),
  [EDITOR_COMMANDS.deleteClip]: z.object({
    ...target,
    /** A clip or a gap on V1. */
    clipId: itemId,
    mode: z.enum(DELETE_MODES).default('ripple'),
  }),
  [EDITOR_COMMANDS.insertClip]: z.object({
    ...target,
    media: insertMediaSchema,
    position: insertPositionSchema,
    /** Its length. Absent: V1's median clip length, shorter when the media ends sooner. */
    duration: time.optional(),
  }),
  [EDITOR_COMMANDS.duplicateClip]: z.object({ ...target, clipId: itemId }),
  [EDITOR_COMMANDS.setSpeed]: z.object({
    ...target,
    clipId: itemId,
    speed: speedChangeSchema,
    fit: z.enum(SPEED_FITS).default('media'),
    audio: z.enum(SPEED_AUDIO).optional(),
  }),
  [EDITOR_COMMANDS.setTransition]: z.object({
    ...target,
    clipId: itemId,
    /** 'end' joins the clip to the next one; 'start' to the one before. */
    edge: z.enum(CLIP_EDGES).default('end'),
    kind: z.enum(DRAWN_TRANSITION_KINDS),
    direction: z.enum(DIRECTIONS).nullable().default(null),
    /** Its whole length, centred on the cut where the media allows. Absent: half a second (a whip a quarter). */
    duration: time.optional(),
  }),
  [EDITOR_COMMANDS.removeTransition]: z
    .object({
      ...target,
      transitionId: itemId.optional(),
      /** Or the clip and the edge it is on. */
      clipId: itemId.optional(),
      edge: z.enum(CLIP_EDGES).default('end'),
    })
    .refine((payload) => (payload.transitionId === undefined) !== (payload.clipId === undefined), {
      message: 'Name the transition or its clip, one of the two',
    }),
  [EDITOR_COMMANDS.setGrade]: z.object({
    ...target,
    target: gradeTargetSchema,
    /** The fields to change, the others kept; null takes the target's grade off. */
    grade: gradePatchSchema.nullable(),
  }),
  [EDITOR_COMMANDS.addMarker]: z.object({
    ...target,
    at: time,
    /** Absent: a marker at one instant. */
    duration: nonNegative('duration').optional(),
    kind: z.enum(MARKER_KINDS).default('note'),
    /** Plain text. */
    label: z.string().trim().max(120).default(''),
    /** Absent: the kind's (note GREEN, hook ORANGE, qa RED, beat BLUE). */
    colour: z.enum(MARKER_COLOURS).optional(),
  }),
  [EDITOR_COMMANDS.slipClip]: z
    .object({
      ...target,
      clipId: itemId,
      /** Signed media time: positive plays a later part of the shot. */
      by: time.optional(),
      /** Or the new in-point, at any rate (it lands on the nearest media frame). */
      sourceStart: time.optional(),
      /** Or what to keep out of the clip: the part of the shot nearest the clip's that does, by the in-point rule. */
      avoid: z
        .array(z.enum(SLIP_AVOIDS))
        .min(1)
        .max(SLIP_AVOIDS.length)
        .refine((avoid) => new Set(avoid).size === avoid.length, { message: 'Name each once' })
        .optional(),
    })
    .refine(
      (payload) =>
        [payload.by, payload.sourceStart, payload.avoid].filter((field) => field !== undefined).length === 1,
      { message: 'Give by, sourceStart or avoid, one of the three' },
    ),
  [AUDIO_EDIT_COMMANDS.setVolume]: z
    .object({
      ...target,
      target: audioTargetSchema,
      /** The level, absolute. */
      gainDb: z.number().min(-60).max(12).optional(),
      /** Or a change to each target's level, clamped to −60…12 dB. */
      byDb: z.number().min(-72).max(72).optional(),
      muted: z.boolean().optional(),
      /** From the start (a clip's, or the music's window): zero takes the fade off. */
      fadeIn: nonNegative('fadeIn').optional(),
      fadeOut: nonNegative('fadeOut').optional(),
    })
    .refine((payload) => payload.gainDb === undefined || payload.byDb === undefined, {
      message: 'A level or a change to it, not both',
    })
    .refine(
      (payload) =>
        [payload.gainDb, payload.byDb, payload.muted, payload.fadeIn, payload.fadeOut].some(
          (field) => field !== undefined,
        ),
      { message: 'Nothing to change' },
    ),
  [AUDIO_EDIT_COMMANDS.trim]: z.object({
    ...target,
    target: audioItemTargetSchema,
    edge: z.enum(CLIP_EDGES),
    /** Signed: positive lengthens at that edge. */
    by: time,
  }),
  [AUDIO_EDIT_COMMANDS.move]: z.object({
    ...target,
    target: audioItemTargetSchema,
    /** Signed: positive is later. */
    by: time,
  }),
};

export const editorCommandResultSchema = z.object({
  timelineId: idSchema<'Timeline'>(),
  revision: z.int().min(1),
  /** The item the edit made: a split's second half, an inserted or duplicated clip, a marker. */
  itemId: itemId.optional(),
});
export type EditorCommandResult = z.output<typeof editorCommandResultSchema>;
