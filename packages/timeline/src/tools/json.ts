// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Model-facing schemas: plain JSON Schema-exportable shapes (the tool
 * registry exports every tool's input and output; core's id schemas are
 * custom checks and its rates transform, which JSON Schema can't carry). The
 * command bus validates the payload with core's schemas again on dispatch.
 */
import {
  CAST_NOTES,
  CLIP_FITS,
  clipReframeSchema,
  rationalTimeJsonSchema,
  SWAP_SOURCES,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import { clipRefSchema, readRevisionSchema } from './clip-refs';

/**
 * EDT1-OPS: how far a trim moves its edge, as exactly one of three forms (a oneOf of closed objects, so the tool-call
 * grammar takes one and only one). As three loose fields (bySeconds, byBeats, by) the 9B gave two at once in eval run
 * 13 ({bySeconds 1, byBeats 2}, {bySeconds -1, byBeats -1}). A oneOf at the top of a tool's input isn't an option:
 * Anthropic's API refuses one there, so the choice is this field's. Older callers' bySeconds and byBeats are mended to
 * it (clip-mend.ts); the frames form is the command's own, which QA's fixes give.
 */
export const trimBySchema = z
  .xor(
    [
      z.strictObject({
        seconds: z
          .number()
          .min(-600)
          .max(600)
          .describe('Signed seconds: 1 makes the clip a second longer, -0.5 half a second shorter'),
      }),
      z.strictObject({
        beats: z
          .number()
          .min(-64)
          .max(64)
          .describe(
            "Signed beats of the video's beat (timeline.get's beat): -1 makes the clip a beat shorter, 2 two beats longer",
          ),
      }),
      // The 9B wrote this form's rate as 1 (seconds) or as 2^53, and "a beat shorter" as -1 at rate 1, a whole second.
      z
        .strictObject(rationalTimeJsonSchema.shape)
        .describe(
          "The command's own form, as QA's fixes give it: signed frames at the canvas rate (timeline.get's rate)",
        ),
    ],
    {
      error:
        'Give by as one of {"seconds": n}, {"beats": n} or frames as {"value": n, "rate": the canvas rate}',
    },
  )
  .describe(
    'How far the edge moves, signed (positive lengthens), as one of: {"seconds": 1} a second longer, {"seconds": -0.5} half a second shorter, {"beats": -1} a beat shorter',
  );

export const candidateJson = z.object({
  assetId: ulidSchema('Asset'),
  shotId: ulidSchema('Shot').nullable(),
  sourceStart: rationalTimeJsonSchema,
  syncPoint: rationalTimeJsonSchema.nullable(),
  score: z.number(),
  parts: z.object({
    intent: z.number(),
    motion: z.number(),
    quality: z.number(),
    subject: z.number(),
    energy: z.number(),
    hook: z.number().nullable(),
    rerank: z.number().nullable(),
    penalty: z.number(),
  }),
});

const target = {
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: readRevisionSchema,
};
const clipId = ulidSchema('TimelineItem');
const boxInputSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  })
  .describe("Shares of the frame: x and y are the box's top-left corner");
const textEditInputEntrySchema = z.object({
  itemId: clipId,
  text: z.string().trim().min(1).max(500).optional().describe('New wording (1–500 characters)'),
  atSeconds: z.number().min(0).max(3600).optional().describe('Start time in the timeline, in seconds'),
  durationSeconds: z
    .number()
    .positive()
    .max(3600)
    .optional()
    .describe('How long the text stays on screen, in seconds'),
  box: boxInputSchema.optional().describe('Optional new bounding box in 0..1'),
  remove: z.boolean().optional().describe('true removes this text item from the timeline'),
});
const textMoveInputEntrySchema = z.object({
  itemId: clipId,
  box: boxInputSchema,
});
/** EDT1-OPS: the clip by its number or "this" (clip-refs.ts), or by its id; the revision the number was read at. */
const oneClip = {
  clip: clipRefSchema.optional(),
  clipId: clipId.optional().describe('Or the clip’s id'),
  revision: readRevisionSchema,
};

/** Each edit command's payload, as the model writes it. */
export const editInputs = {
  'timeline.swapClip': z.object({
    ...target,
    ...oneClip,
    media: z.object({ assetId: ulidSchema('Asset'), shotId: ulidSchema('Shot').nullable() }),
    sourceStart: rationalTimeJsonSchema.optional(),
    from: z.enum(SWAP_SOURCES),
  }),
  'timeline.trimClip': z.object({
    ...target,
    // EDT1-OPS: the clip, required: its number, "this", or its id (clip-refs.ts).
    clip: clipRefSchema,
    revision: readRevisionSchema,
    edge: z.enum(['start', 'end']),
    by: trimBySchema,
  }),
  'timeline.moveClip': z.object({
    ...target,
    clip: clipRefSchema,
    revision: readRevisionSchema,
    // EDT1-OPS: counted like the clips, from 1. The 0-based toIndex ("the end is 5 with 6 clips") was read as the
    // skyline's number, the last of six clips, in four eval runs; the command still takes the position from 0.
    to: z
      .union([z.enum(['start', 'end']), z.int().min(1).max(400), z.string().min(1).max(5)])
      .describe(
        'Where it goes, counted like the clips: "start" (or 1), "end", or the number it will have (3 makes it the third clip)',
      ),
  }),
  'timeline.editText': z.object({
    ...target,
    itemId: clipId.optional().describe('Single text itemId to edit'),
    text: z.string().trim().min(1).max(500).optional().describe('New wording for itemId (1–500 characters)'),
    atSeconds: z.number().min(0).max(3600).optional().describe('Optional new start time in seconds'),
    durationSeconds: z
      .number()
      .positive()
      .max(3600)
      .optional()
      .describe('Optional new duration in seconds'),
    box: boxInputSchema.optional().describe('Optional new bounding box in 0..1'),
    remove: z.boolean().optional().describe('true removes itemId from the timeline'),
    edits: z
      .array(textEditInputEntrySchema)
      .min(1)
      .max(50)
      .optional()
      .describe('Batch text edits: update wording, timing, box, or remove multiple text items in one call'),
  }),
  // EDT1-OPS: a box that runs off the frame is moved back inside it (the tool's payload), not refused: the 9B gave
  // x as the box's centre. The command still takes only boxes inside the frame.
  'timeline.moveText': z.object({
    ...target,
    itemId: clipId.optional().describe('Single text itemId to move'),
    itemIds: z
      .array(clipId)
      .min(1)
      .max(50)
      .optional()
      .describe('Batch move: multiple text itemIds to place at box in one call'),
    box: boxInputSchema.optional(),
    moves: z
      .array(textMoveInputEntrySchema)
      .min(1)
      .max(50)
      .optional()
      .describe('Batch moves with individual boxes per text itemId'),
  }),
  'timeline.lockClip': z.object({ ...target, ...oneClip, locked: z.boolean() }),
  'timeline.applyCast': z.object({
    ...target,
    picks: z
      .array(z.object({ slotId: ulidSchema('TemplateSlot'), pick: candidateJson }))
      .min(1)
      .max(200),
  }),
  'timeline.setClipFit': z.object({ ...target, ...oneClip, fit: z.enum(CLIP_FITS) }),
  'timeline.resyncBeats': z.object(target),
  'timeline.trimToDuration': z.object({
    ...target,
    maxSeconds: z.number().positive().max(3600).describe("The platform's longest video, in seconds"),
  }),
  'timeline.setReframe': z.object({
    ...target,
    clip: clipRefSchema.optional(),
    clipId: clipId.optional().describe('Or the clip’s id'),
    revision: z.int().positive().optional(),
    reframe: clipReframeSchema
      .nullable()
      .describe('null: back to the plain fit; scale above 1 is a punch-in'),
  }),
} as const;

export const castNoteJson = z.enum(CAST_NOTES).nullable();
