// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EDT2: durable beginner edits. UI and tools submit the same revision-checked operations. */
import { z } from 'zod';
import { ulidSchema } from '../basics/ids';
import { rationalTimeJsonSchema } from '../time/rational-time';
const timeRangeSchema = z.object({ start: rationalTimeJsonSchema, duration: rationalTimeJsonSchema });
import { gradePatchSchema } from './grade';
import { clipAudioSchema, clipReframeSchema, CLIP_FITS } from './timeline-items';

export const VIDEO_SIZES = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
} as const;
export const videoAspectSchema = z.enum(['9:16', '4:5', '1:1', '16:9']);
export type VideoAspect = z.output<typeof videoAspectSchema>;

/** Identifies a word occurrence, including which duplicate of its source is on the timeline. */
export const transcriptOccurrenceRefSchema = z.object({
  clipId: ulidSchema('TimelineItem'),
  assetId: ulidSchema('Asset'),
  segment: z.int().nonnegative(),
  word: z.int().nonnegative(),
  /** Checked against the current transcript to refuse stale or changed word timings. */
  source: timeRangeSchema,
});
export const transcriptOccurrenceSchema = transcriptOccurrenceRefSchema.extend({
  text: z.string().min(1).max(200).meta({ untrusted: 'transcript' }),
  range: timeRangeSchema,
});
export type TranscriptOccurrenceRef = z.output<typeof transcriptOccurrenceRefSchema>;
export type TranscriptOccurrence = z.output<typeof transcriptOccurrenceSchema>;
export const timelineTranscriptSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  words: z.array(transcriptOccurrenceSchema).max(100_000),
});
export type TimelineTranscript = z.output<typeof timelineTranscriptSchema>;

const target = {
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
};
const clipId = ulidSchema('TimelineItem');
const clipIds = z.array(clipId).min(1).max(400);
const time = rationalTimeJsonSchema;
export const CLIP_SETTINGS = ['color', 'sound', 'framing'] as const;

export const SIMPLE_EDITOR_COMMANDS = {
  removeWords: 'timeline.removeWords',
  replaceCaptions: 'timeline.replaceCaptions',
  adjustClips: 'timeline.adjustClips',
  copyClipSettings: 'timeline.copyClipSettings',
  addNarration: 'timeline.addNarration',
  makeSize: 'timeline.makeSize',
  freezeFrame: 'timeline.freezeFrame',
  setHoldDuration: 'timeline.setHoldDuration',
} as const;

export const simpleEditorPayloads = {
  [SIMPLE_EDITOR_COMMANDS.removeWords]: z.object({
    ...target,
    words: z.array(transcriptOccurrenceRefSchema).min(1).max(5000),
  }),
  [SIMPLE_EDITOR_COMMANDS.replaceCaptions]: z.object({
    ...target,
    find: z.string().min(1).max(500),
    replacement: z.string().max(500),
    matchCase: z.boolean().default(false),
    cueIds: z.array(ulidSchema('CaptionCue')).min(1).max(10_000).optional(),
  }),
  [SIMPLE_EDITOR_COMMANDS.adjustClips]: z
    .object({
      ...target,
      clipIds,
      color: gradePatchSchema.optional(),
      sound: clipAudioSchema
        .omit({ fadeIn: true, fadeOut: true })
        .extend({ fadeIn: time.optional(), fadeOut: time.optional() })
        .partial()
        .optional(),
      framing: z.object({ fit: z.enum(CLIP_FITS), reframe: clipReframeSchema.nullable() }).optional(),
    })
    .refine(
      (input) => input.color !== undefined || input.sound !== undefined || input.framing !== undefined,
      { message: 'Choose at least one adjustment' },
    ),
  [SIMPLE_EDITOR_COMMANDS.copyClipSettings]: z.object({
    ...target,
    sourceClipId: clipId,
    clipIds,
    settings: z.array(z.enum(CLIP_SETTINGS)).min(1).max(3),
  }),
  [SIMPLE_EDITOR_COMMANDS.addNarration]: z
    .object({
      ...target,
      assetId: ulidSchema('Asset').optional(),
      captureKey: ulidSchema('VoiceCapture').optional(),
      at: time,
    })
    .refine((input) => (input.assetId !== undefined) !== (input.captureKey !== undefined), {
      message: 'Choose a saved asset or a recorded take',
    }),
  [SIMPLE_EDITOR_COMMANDS.makeSize]: z.object({
    ...target,
    aspect: videoAspectSchema,
    sourceFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  [SIMPLE_EDITOR_COMMANDS.freezeFrame]: z.object({
    ...target,
    clipId,
    at: time,
    duration: time.default({ value: 2, rate: { num: 1, den: 1 } }),
  }),
  [SIMPLE_EDITOR_COMMANDS.setHoldDuration]: z.object({ ...target, clipId, duration: time }),
};

export const simpleEditorResultSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  affectedItemIds: z.array(ulidSchema('TimelineItem')).default([]),
  itemId: ulidSchema('TimelineItem').optional(),
  replacements: z.int().nonnegative().optional(),
});
