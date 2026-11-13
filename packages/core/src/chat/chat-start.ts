// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a chat message can carry besides its text (P2-M12, V3): the opening
 * card's choice of flow, the user's selection chips, and the answer to a
 * skill's question (how many variants).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { GAP_FIX_KINDS } from '../skills/skill-refs';
import { FORMAT_IDS } from '../templates/template-parts';
import { p31MillisecondRangeSchema } from '../time/milliseconds';
import { timeRangeSchema } from '../time/time-range';
import { editItemTargetSchema, editorContextSchema } from '../timeline/edit-target';
import { MAX_COMMENT_BATCH } from '../comments/comment-schema';
import { chatEffectIdSchema } from './chat-effects';

/** The ways in (packages/agent SPEC, "Flows"): use my library, paste a reel, start from a template, describe. */
export const OPENING_PATHS = ['library', 'reference', 'template', 'describe'] as const;
export type OpeningPath = (typeof OPENING_PATHS)[number];

export const referenceInputSchema = z.discriminatedUnion('kind', [
  /** A Shorts, Reels or TikTok link, fetched at once (no warning card since REF1). */
  z.object({ kind: z.literal('link'), url: z.url({ protocol: /^https$/ }).max(2048) }),
  /** A file or screen recording the user dropped or picked (main's picker or the preload's pathFor). */
  z.object({ kind: z.literal('file'), path: z.string().min(1).max(4096) }),
]);
export type ReferenceInput = z.output<typeof referenceInputSchema>;

/** An opening card's choice: which flow to run. */
export const chatStartSchema = z.discriminatedUnion('path', [
  z.object({ path: z.literal('library') }),
  z.object({ path: z.literal('reference'), reference: referenceInputSchema }),
  z.object({ path: z.literal('template'), templateId: idSchema<'Template'>() }),
  /** `formatId`: a bundled format picked as the start (Start from a template → a format). */
  z.object({ path: z.literal('describe'), formatId: z.enum(FORMAT_IDS).optional() }),
]);
export type ChatStart = z.output<typeof chatStartSchema>;

/**
 * What the user pointed at or tagged when writing (V3): a clip, a range of a timeline, a template slot, or a video
 * effect. EDT1: `item` is any item of a timeline (edit-target.ts), which the editor's chips are from now on; a
 * `clip` chip stored before still reads as it did.
 */
export const selectionChipSchema = z.discriminatedUnion('kind', [
  editItemTargetSchema,
  z.object({
    kind: z.literal('clip'),
    timelineId: idSchema<'Timeline'>(),
    clipId: idSchema<'TimelineItem'>(),
  }),
  z.object({ kind: z.literal('range'), timelineId: idSchema<'Timeline'>(), range: timeRangeSchema }),
  /** By slot id, which is stable across template versions. */
  z.object({
    kind: z.literal('slot'),
    templateId: idSchema<'Template'>(),
    slotId: idSchema<'TemplateSlot'>(),
  }),
  /** A named video effect tagged from the Composer's Effects CTA (single or multiple). */
  z.object({
    kind: z.literal('effect'),
    effectId: chatEffectIdSchema,
  }),
  /** A footage, audio or image asset chosen from the Library ("Make a video with these"). */
  z.object({
    kind: z.literal('asset'),
    assetId: idSchema<'Asset'>(),
    name: z.string().min(1).max(200).optional(),
  }),
]);
export type SelectionChip = z.output<typeof selectionChipSchema>;
export const MAX_SELECTIONS = 50;

export const REFERENCE_POINTER_BASES = ['template', 'timeline'] as const;
export const REFERENCE_POINTER_KINDS = ['slot', 'cut', 'range', 'clip', 'unresolved'] as const;

/** P3-V15: a place in the reference or the video the user's words pointed at ("at 0:04", "the third shot"). */
export const referencePointerSchema = z.object({
  /** The words the user wrote: untrusted, at most 80 characters. */
  said: z.string().min(1).max(80),
  basis: z.enum(REFERENCE_POINTER_BASES),
  kind: z.enum(REFERENCE_POINTER_KINDS),
  templateId: idSchema<'Template'>().nullable(),
  timelineId: idSchema<'Timeline'>().nullable(),
  slotId: idSchema<'TemplateSlot'>().nullable(),
  slotNumber: z.int().min(1).max(200).nullable(),
  clipId: idSchema<'TimelineItem'>().nullable(),
  /**
   * The span pointed at, in the basis's time (the template's or the timeline's canvas rate). Round P3-1 stored
   * `{ startMs, endMs }`: it reads as the same span at 1000/1.
   */
  range: z
    .union([
      timeRangeSchema.refine((range) => range.start.value >= 0, {
        message: 'Starts before zero',
        path: ['start'],
      }),
      p31MillisecondRangeSchema,
    ])
    .nullable(),
});
export type ReferencePointer = z.output<typeof referencePointerSchema>;

/** An answer to a skill's question (an approval of kind 'question'), sent with chat.decideApproval. */
const modelRef = z.object({ provider: z.string().min(1), model: z.string().min(1) });
export const RATE_LIMIT_CHOICES = ['wait', 'switch', 'stop'] as const;

export const questionAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('variants'), count: z.int().min(1).max(10) }),
  /**
   * P3-B8: a fix per gap, keyed by the gap's item id; [] declines. Film and drop are commands too. FIX-GAPS: a swap
   * names the candidate it takes (one of the card's `swap` option's). FIX-ASK: so do a borrow and a reuse (one of
   * that option's candidates); `addClips` waits for the person's new clips, then casts the open gaps again.
   */
  z.object({
    kind: z.literal('gapFix'),
    fixes: z
      .array(
        z.object({
          gapId: idSchema<'TimelineItem'>(),
          fix: z.enum(GAP_FIX_KINDS),
          swapTo: z
            .object({ assetId: idSchema<'Asset'>(), shotId: idSchema<'Shot'>().nullable() })
            .optional(),
        }),
      )
      .max(50),
  }),
  /** G8: the rateLimit card's choice; `model` with 'switch', one of the card's options. */
  z
    .object({ kind: z.literal('rateLimit'), choice: z.enum(RATE_LIMIT_CHOICES), model: modelRef.optional() })
    .refine((answer) => (answer.choice === 'switch') === (answer.model !== undefined), {
      message: 'A switch names the model, and only a switch does',
      path: ['model'],
    }),
]);
export type QuestionAnswer = z.output<typeof questionAnswerSchema>;

/** What `chat.send` and the stored user message carry besides the text. */
export const messageExtrasShape = {
  /** The opening card's choice: starts that flow. */
  start: chatStartSchema.optional(),
  selections: z.array(selectionChipSchema).max(MAX_SELECTIONS).optional(),
  /** P3-V15: what the message pointed at, set by the agent when it resolves the message; shown as chips. */
  pointers: z.array(referencePointerSchema).max(10).optional(),
  /** EDT1: the editor as the user saw it, from the editor's docked composer only. */
  editorContext: editorContextSchema.optional(),
  /**
   * EDT1-CMT: "Send N comments to Taalcut": the comments this message hands to the agent, in the editor's order. The
   * agent sends the open ones to the run (`comments.send`) and its Editor answers each.
   */
  comments: z.array(idSchema<'TimelineComment'>()).min(1).max(MAX_COMMENT_BATCH).optional(),
};
