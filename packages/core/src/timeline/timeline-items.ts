// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The items of a Timeline document: clips, gaps and transitions on video and
 * audio tracks, text items and motion graphics on text tracks, and markers.
 * timeline-schema.ts assembles them into the document and timeline-rules.ts
 * checks them. Version 2 (P3) adds a clip's `stillMotion` and `reframe`, an
 * audio track's `role` and graphics on text tracks.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { rationalTimeSchema } from '../time/rational-time';
import { timeRangeSchema } from '../time/time-range';
import {
  beatAnchorSchema,
  boxSchema,
  DIRECTIONS,
  languageTagSchema,
  speedRampSchema,
  styleKeySchema,
  textAppearanceSchema,
  TEXT_REVEALS,
  TEXT_ROLES,
  TRANSITION_KINDS,
} from '../templates/template-parts';
import { gradeSchema } from './grade';
import { graphicItemSchema } from './graphics';
import { madePlacementSchema } from './made-placement';
import { authoredProgramItemSchema } from '../creation/authored-program';
import { clipVisualLayoutSchema } from './visual-layout';

const time = rationalTimeSchema;
const itemId = idSchema<'TimelineItem'>();
const slotId = idSchema<'TemplateSlot'>().nullable();

/** What a clip plays: a video (or one shot of it), a still, or audio. */
export const mediaRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('video'),
    assetId: idSchema<'Asset'>(),
    shotId: idSchema<'Shot'>().nullable(),
    /** The media's full range, at its own rate. */
    available: timeRangeSchema,
  }),
  z.object({ kind: z.literal('image'), assetId: idSchema<'Asset'>() }),
  z.object({ kind: z.literal('audio'), assetId: idSchema<'Asset'>(), available: timeRangeSchema }),
]);

/** How a clip fills the 9:16 canvas: crop to fill, or fit whole with bars. */
export const CLIP_FITS = ['cover', 'contain'] as const;

/** How a still moves on screen (P3-B7, P3-B8); render draws it. */
export const STILL_MOTIONS = ['none', 'pushIn', 'pullOut', 'panLeft', 'panRight'] as const;
export type StillMotion = (typeof STILL_MOTIONS)[number];

/**
 * Which part of a video's frame shows (P3-V2, P3-V9; render SPEC P3.2). `auto` follows the subject and falls
 * back per shot to a centre crop or a blurred pad; the other modes are the person's choice.
 */
export const REFRAME_MODES = ['auto', 'subject', 'centre', 'blurPad'] as const;
export type ReframeMode = (typeof REFRAME_MODES)[number];

export const clipReframeSchema = z.object({
  mode: z.enum(REFRAME_MODES),
  /** The person's offset of the followed point (or of the centre), as a fraction of the crop's width and height. */
  nudge: z.object({ x: z.number().min(-0.5).max(0.5), y: z.number().min(-0.5).max(0.5) }),
  /** A punch-in: the crop window shrunk by this factor about the followed point; 1 is none. */
  scale: z.number().min(1).max(2),
});
export type ClipReframe = z.output<typeof clipReframeSchema>;

/**
 * A clip's own sound. EDT1-OPS adds fades (`audio.setVolume`), at the canvas rate from the clip's ends; absent is
 * none. Render plays the longer of a fade and a transition's overlap at each end.
 */
export const clipAudioSchema = z.object({
  gainDb: z.number().min(-60).max(12),
  muted: z.boolean(),
  fadeIn: time.optional(),
  fadeOut: time.optional(),
});
export type ClipAudio = z.output<typeof clipAudioSchema>;

export const clipSchema = z.object({
  type: z.literal('clip'),
  id: itemId,
  media: mediaRefSchema,
  /** First source instant used, at the media's rate (zero for images). */
  sourceStart: time,
  /** EDT2: repeat this exact source frame; absent means ordinary moving footage. */
  holdFrame: time.optional(),
  /** Length on the timeline, at the canvas rate. */
  duration: time,
  /** Null plays in real time. */
  speed: speedRampSchema.nullable(),
  slotId,
  /** The source instant (a motion peak) that must land on `beatAnchor`. */
  syncPoint: time.nullable(),
  beatAnchor: beatAnchorSchema.nullable(),
  fit: z.enum(CLIP_FITS),
  audio: clipAudioSchema,
  /** Cast board lock: the agent never changes it. */
  locked: z.boolean(),
  enabled: z.boolean(),
  /** Image clips only: how the still moves. Null: render's default for stills. */
  stillMotion: z.enum(STILL_MOTIONS).nullable(),
  /** Video clips only. Null: Phase 2 behaviour (`fit` decides; `cover` is a centre crop). */
  reframe: clipReframeSchema.nullable(),
  visualLayout: clipVisualLayoutSchema.optional(),
  /** EDT1-OPS: the clip's own colour grade (`timeline.setGrade`), over the video's; absent is none. Pictures only. */
  grade: gradeSchema.optional(),
});

export const gapSchema = z.object({ type: z.literal('gap'), id: itemId, duration: time, slotId });

export const transitionItemSchema = z.object({
  type: z.literal('transition'),
  id: itemId,
  kind: z.enum(TRANSITION_KINDS),
  /** Into the outgoing clip, as OTIO's in_offset. */
  inOffset: time,
  /** Into the incoming clip, as OTIO's out_offset. */
  outOffset: time,
  direction: z.enum(DIRECTIONS).nullable(),
});

export const sequenceItemSchema = z.discriminatedUnion('type', [
  clipSchema,
  gapSchema,
  transitionItemSchema,
  authoredProgramItemSchema,
]);

export const textItemSchema = z.object({
  type: z.literal('text'),
  id: itemId,
  start: time,
  duration: time,
  /** Plain text; from the template (untrusted reference text), the Editor or the user. */
  text: z.string().min(1).max(500),
  role: z.enum(TEXT_ROLES),
  slotId,
  overlayId: idSchema<'TextOverlay'>().nullable(),
  box: boxSchema,
  appearance: textAppearanceSchema,
  styleKey: styleKeySchema,
  reveal: z.enum(TEXT_REVEALS),
  language: languageTagSchema.nullable(),
  origin: z.enum(['template', 'editor', 'user']),
  /** FRM1-OVL: why `box` is where it is (the placement solver's); absent when the person set it or before FRM1. */
  placement: madePlacementSchema.optional(),
});

/** What a text track holds: text items and motion graphics (graphics.ts), without overlaps. */
export const textTrackItemSchema = z.discriminatedUnion('type', [textItemSchema, graphicItemSchema]);

/** An audio track's job; code reads the role, never the id (by convention A2 is the voice, A3 the effects). */
export const AUDIO_TRACK_ROLES = ['clip', 'voice', 'sfx'] as const;
export type AudioTrackRole = (typeof AUDIO_TRACK_ROLES)[number];

const trackBase = {
  /** V1, A1, T1: kind letter and index. */
  id: z.string().regex(/^[VAT][1-9]$/),
  name: z.string().max(60),
  enabled: z.boolean(),
};
export const trackSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('video'), ...trackBase, items: z.array(sequenceItemSchema).max(400) }),
  z.object({
    kind: z.literal('audio'),
    ...trackBase,
    role: z.enum(AUDIO_TRACK_ROLES),
    items: z.array(sequenceItemSchema).max(400),
  }),
  z.object({ kind: z.literal('text'), ...trackBase, items: z.array(textTrackItemSchema).max(400) }),
]);

export const MARKER_KINDS = ['hook', 'beat', 'qa', 'note'] as const;
/** OTIO Marker.2 colour names. */
export const MARKER_COLOURS = [
  'PINK',
  'RED',
  'ORANGE',
  'YELLOW',
  'GREEN',
  'CYAN',
  'BLUE',
  'PURPLE',
  'MAGENTA',
  'BLACK',
  'WHITE',
] as const;
export const markerSchema = z.object({
  id: itemId,
  range: timeRangeSchema,
  kind: z.enum(MARKER_KINDS),
  label: z.string().max(120),
  colour: z.enum(MARKER_COLOURS),
});

export type Track = z.output<typeof trackSchema>;
export type Clip = z.output<typeof clipSchema>;
export type Gap = z.output<typeof gapSchema>;
export type TransitionItem = z.output<typeof transitionItemSchema>;
export type SequenceItem = z.output<typeof sequenceItemSchema>;
export type TextItem = z.output<typeof textItemSchema>;
export type TextTrackItem = z.output<typeof textTrackItemSchema>;
export type Marker = z.output<typeof markerSchema>;
export type MediaRef = z.output<typeof mediaRefSchema>;
