// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The templates tools' schemas. They must convert to JSON Schema for the
 * model, so ids are ULID strings (core's branded idSchema can't be exported)
 * and times are plain { value, rate } objects; the command bus validates the
 * real payloads when a tool dispatches.
 */
import {
  artifactRefSchema,
  FORMAT_IDS,
  OVERLAY_DESIGN_KINDS,
  SHOT_TYPES,
  SLOT_ROLES,
  TEXT_REVEALS,
  TEXT_ROLES,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import { analystIntentSchema } from '../breakdown/build-template';
import { CAMERA_WORDS_CHARS } from '../breakdown/camera';
import { LOOKS_CHARS, SLOT_CONTEXT_LIMITS, TEXT_POSITIONS } from '../breakdown/slot-context';
import { INTENT_LIMITS, MAX_SLOT_PAGE } from '../breakdown/slot-context-pages';
import { plainTimeSchema } from '../jobs/kinds';

export { plainTimeSchema };

/**
 * A slot's intent as templates.setIntents takes it. The shot type is required here ('text' and 'screen' are shot
 * types): a slot without one is open, and the Analyst's handoff check would send it back after the reference, and
 * the frames to look at, are gone. FRM1-MOT: no camera motion: the template measures it (breakdown/camera.ts). The
 * text, subject and place are offered at INTENT_LIMITS, the lengths a page's budget counts them at
 * (`breakdown/slot-context-pages.ts`). AGT1: a longer one is taken, up to the store's limits (analystIntentSchema):
 * the tool-call grammar leaves lengths to the tool, and a refusal for a few characters cost a page's turn (n3).
 */
export const slotIntentEntrySchema = z.object({
  // A template has at most 200 slots (core's templateSchema).
  slotIndex: z.int().min(0).max(199).describe('From templates.resolveCuts'),
  intent: analystIntentSchema.omit({ motion: true }).extend({
    text: z.string().trim().min(1).max(500).meta({ maxLength: INTENT_LIMITS.textChars }),
    shotType: z.enum(SHOT_TYPES),
    subject: z.string().max(120).meta({ maxLength: INTENT_LIMITS.subjectChars }).nullable(),
    place: z.string().max(120).meta({ maxLength: INTENT_LIMITS.placeChars }).nullable(),
    reel: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .meta({ maxLength: INTENT_LIMITS.reelChars })
      .optional()
      .describe('What the reel literally shows: its places, landmarks, signs. Only for a slot without looks'),
    needs: analystIntentSchema.shape.needs.describe(
      'What a viewer must see in the footage for this slot to work: the thing or action its moment or a graphic ' +
        "over it hangs on, in short phrases that fit anyone's footage. Empty when nothing in particular",
    ),
    face: analystIntentSchema.shape.face.describe(
      "Whether the reel shows the person's face in this slot: shown, hidden (from behind, turned away, cropped " +
        'out), or null with nobody in it',
    ),
  }),
  role: z.enum(SLOT_ROLES).optional(),
});

/** A string from the reference (its title, sound credit): the mark sits on the string, not its nullable. */
const referenceText = z.string().meta({ untrusted: 'reference' });

export const fetchReferenceInputSchema = z.object({
  projectId: ulidSchema('Project'),
  url: z.string().min(1).max(2048).describe('The link the user pasted'),
});
export const fetchReferenceOutputSchema = z.object({
  experimentId: ulidSchema('Experiment'),
  platform: z.enum(['shorts', 'reels', 'tiktok', 'other']),
  duration: plainTimeSchema,
  /** The platform's credited sound: the reference's own text, so fenced for the model (agent SPEC 7, 12). */
  sound: z.object({ title: referenceText.nullable(), artist: referenceText.nullable() }).nullable(),
});

export const breakdownInputSchema = z
  .object({
    projectId: ulidSchema('Project'),
    experimentId: ulidSchema('Experiment').optional().describe('From templates.fetchReference'),
    path: z.string().min(1).max(4096).optional().describe('Or a file the user dropped'),
    screenRecording: z.boolean().optional(),
  })
  .refine((input) => (input.experimentId === undefined) !== (input.path === undefined), {
    message: 'Give exactly one of experimentId and path',
  });

/** A disputed cut to judge, with its frames before and after (`breakdown/slot-context-disputes.ts`). */
export const disputeSchema = z.object({
  at: z.int(),
  method: z.enum(['both', 'scdet', 'embedding']),
  transition: z.string().nullable(),
  ruleKeeps: z.boolean(),
  before: z.string(),
  after: z.string(),
});

/** Where judging the disputed cuts stands: how many of those to judge have a verdict, and the next without one. */
const judgingShape = {
  judged: z.int().nonnegative(),
  toJudge: z.int().nonnegative(),
  next: disputeSchema.nullable(),
};

export const breakdownOutputSchema = z.object({
  breakdownId: ulidSchema('Experiment'),
  summary: z.string(),
  cuts: z.int().nonnegative(),
  /** How many cuts only one method found. */
  disputes: z.int().nonnegative(),
  ...judgingShape,
  warnings: z.array(z.string()),
  /** The whole draft, stored as an artifact so it never floods the context. */
  draft: artifactRefSchema.optional(),
});

export const judgeCutInputSchema = z.object({
  breakdownId: ulidSchema('Experiment'),
  at: z.int().nonnegative().describe('The disputed cut frame (next.at)'),
  cut: z
    .boolean()
    .describe(
      'true: a new shot starts here; false: the same shot goes on (a flash, blur, whip pan or text change)',
    ),
});
export const judgeCutOutputSchema = z.object(judgingShape);

export const resolveCutsInputSchema = z.object({ breakdownId: ulidSchema('Experiment') });
/**
 * What the breakdown knows about a slot (LRN1-CTX, `breakdown/slot-context.ts`). The on-screen text and the
 * speech are the reference's own, so each string is marked untrusted where it sits: the agent lifts it into an
 * <untrusted> block (agent SPEC 7, 12). Lengths are capped by SLOT_CONTEXT_LIMITS before they get here.
 */
export const slotContextSchema = z.object({
  seconds: z.number().positive(),
  onBeat: z.boolean().optional(),
  onScreen: z
    .array(
      z.object({
        text: z.string().max(SLOT_CONTEXT_LIMITS.onScreenChars).meta({ untrusted: 'ocr' }),
        role: z.enum(TEXT_ROLES),
        position: z.enum(TEXT_POSITIONS),
        reveal: z.enum(TEXT_REVEALS).exclude(['none']).optional(),
        earlier: z.literal(true).optional(),
        /** FIX-HOOK: what it is drawn on, measured (breakdown/slot-context.ts `shape`). */
        shape: z.enum(OVERLAY_DESIGN_KINDS).exclude(['plain']).optional(),
      }),
    )
    .min(1)
    .max(SLOT_CONTEXT_LIMITS.tracksPerSlot)
    .optional(),
  speech: z.string().min(1).max(SLOT_CONTEXT_LIMITS.speechChars).meta({ untrusted: 'speech' }).optional(),
  /** FRM1-MOT: the camera's move through the slot, measured on this Mac, in words (breakdown/camera.ts). */
  camera: z.string().min(1).max(CAMERA_WORDS_CHARS).optional(),
  /** BRK1 looks: what the slot's strip shows, described on this Mac (breakdown/looks.ts); its frame is then null. */
  looks: z.string().min(1).max(LOOKS_CHARS).meta({ untrusted: 'vision' }).optional(),
});

/**
 * One page of the slots that have no intent yet (LRN1-CTX, SPEC "Writing the slots a page at a time"), as many as
 * the model's window holds (`breakdown/slot-context-pages.ts`), each with its frame (null when the breakdown has no
 * frame inside it, or when its strip is described in `context.looks`) and its context; `written` of `total` slots
 * have an intent.
 */
export const resolveCutsOutputSchema = z.object({
  total: z.int().min(1),
  written: z.int().nonnegative(),
  slots: z.array(z.object({ index: z.int(), frame: z.string().nullable(), context: slotContextSchema })),
});

export const setIntentsInputSchema = z.object({
  breakdownId: ulidSchema('Experiment'),
  intents: z.array(slotIntentEntrySchema).min(1).max(MAX_SLOT_PAGE),
});
export const setIntentsOutputSchema = z.object({
  written: z.int().nonnegative(),
  total: z.int().min(1),
  /** AGT1: the intents Taalcut rewrote to fit anyone's footage, as stored (transferable-repair.ts). */
  rewritten: z
    .array(
      z.object({
        slotIndex: z.int().nonnegative(),
        field: z.enum(['text', 'subject', 'place']),
        to: z.string().nullable(),
      }),
    )
    .optional(),
  note: z.string().optional(),
});

/** The verdicts and intents are the ones templates.judgeCut and templates.setIntents stored. */
export const finaliseInputSchema = z.object({
  projectId: ulidSchema('Project'),
  breakdownId: ulidSchema('Experiment'),
  name: z.string().trim().min(1).max(120),
});
export const templateRefOutputSchema = z.object({
  templateId: ulidSchema('Template'),
  version: z.int().min(1),
});

export const breakdownIdInputSchema = z.object({ breakdownId: ulidSchema('Experiment') });

export const planFromFormatInputSchema = z.object({
  projectId: ulidSchema('Project'),
  /**
   * Every Format core lists: each has a registered module, and the brief skill may hand off any of them
   * (agent's OFFERED_FORMATS), so the tool the Librarian plans with accepts them all.
   */
  formatId: z.enum(FORMAT_IDS),
  targetSeconds: z.number().min(6).max(120),
  bpm: z.number().min(80).max(180).optional(),
  brief: z.string().max(500).optional(),
  aspect: z.enum(['9:16', '16:9', '1:1', '4:5']).optional(),
});

export const listInputSchema = z.object({
  query: z.string().max(200).optional(),
  fingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  includeUnlisted: z.boolean().optional(),
  limit: z.int().min(1).max(50).optional(),
});
export const summaryOutputSchema = z.object({
  id: ulidSchema('Template'),
  name: z.string(),
  head: z.int(),
  origin: z.string(),
  platform: z.string().nullable(),
  duration: plainTimeSchema,
  slotCount: z.int(),
  bpm: z.number().nullable(),
  listed: z.boolean(),
  archived: z.boolean(),
});
export const listOutputSchema = z.object({ items: z.array(summaryOutputSchema) });

export const getInputSchema = z.object({
  templateId: ulidSchema('Template'),
  version: z.int().min(1).optional(),
});
