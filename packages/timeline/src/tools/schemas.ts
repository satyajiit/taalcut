// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Inputs and outputs of the `timeline` agent tools (SPEC, "Agent tools"). */
import {
  artifactRefSchema,
  CAMERA_MOTIONS,
  CAST_MODES,
  GRAPHIC_BRIEF_KINDS,
  rationalTimeJsonSchema,
  SHOT_TYPES,
  SLOT_EDGES,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import { clipRefSchema, readRevisionSchema } from './clip-refs';
import { clipViewFields, editorViewSchema, showsOut } from './editor-view';
import { graphicsWaitSchema } from './graphics-wait';
import { slotFactsSchema } from './slot-facts';
import { candidateJson, castNoteJson } from './json';

const projectId = ulidSchema('Project');
/**
 * Text the model must read as data (agent SPEC 7, 12): the agent lifts a string marked here into an
 * <untrusted> block. The mark sits on the string itself, never on an array of them.
 */
const untrustedText = (source: 'on-screen-text' | 'user-text') => z.string().meta({ untrusted: source });
const slotId = ulidSchema('TemplateSlot');
const shotId = ulidSchema('Shot');

export const templateRefInputSchema = z.object({
  id: ulidSchema('Template'),
  /** Default: the head version. */
  version: z.int().min(1).optional(),
});

const castFields = {
  projectId,
  template: templateRefInputSchema,
  mode: z.enum(CAST_MODES).default('template'),
  variants: z.int().min(1).max(10).default(1),
  seed: z.int().default(1),
  pool: z
    .object({
      query: z.string().trim().max(500).optional(),
      capturedFrom: z.int().nonnegative().optional(),
      capturedTo: z.int().nonnegative().optional(),
      sourceIds: z.array(ulidSchema('Source')).max(50).optional(),
    })
    .optional(),
  locked: z
    .array(
      z.object({
        slotId,
        assetId: ulidSchema('Asset'),
        shotId: shotId.nullable(),
        sourceStart: rationalTimeJsonSchema,
      }),
    )
    .max(200)
    .default([]),
  exclude: z.array(shotId).max(500).default([]),
  rerank: z
    .array(z.object({ slotId, order: z.array(shotId).min(1).max(5) }))
    .max(200)
    .optional(),
  /**
   * MOM1: the part of a shot a slot should play, as the model reads it from the shot's moments (stated-parts.ts).
   * Seconds in the shot's file, the clock of playsShotFrom and the moments' times. It applies while that shot fills
   * that slot; the window is chosen inside it, and a stretch shorter than the slot is made just long enough.
   */
  parts: z
    .array(
      z.object({
        slotId,
        shotId,
        from: z
          .number()
          .min(0)
          .max(36_000)
          .describe('Where the stretch starts, in seconds of the shot’s file'),
        to: z
          .number()
          .min(0)
          .max(36_000)
          .optional()
          .describe('Where it ends; left out, the end of the moment that holds `from`'),
      }),
    )
    .max(200)
    .optional(),
};

/**
 * MATCH1: what became of a stated moment, measured from what fills its slot (landed-moments.ts). A moment is stated
 * as the part of a slot whose template says one lands on its edge: the part's `to` (edge end) or `from` (start).
 */
const momentOutcome = z.object({
  shotId,
  edge: z.enum(SLOT_EDGES),
  at: z.number(),
  landed: z.boolean(),
  /** Where in the video that frame shows, in seconds. */
  videoSeconds: z.number().optional(),
  playsShotFrom: z.number().optional(),
  playsShotTo: z.number().optional(),
  /** Not landed: what stands in the way, as facts. */
  why: z.string().optional(),
});

/**
 * MATCH1: the person slots whose cut hangs on one instant (the template's `lands`) and how to state it; only when
 * there is such a slot. `at` is the instant a stated part was read as (seconds of the shot's file), absent while
 * none is stated: a part given for another reason is read the same way, so the answer always says what was taken.
 * The moment's words are the Analyst's, from a reference: data.
 */
const landsAsked = z.object({
  how: z.string(),
  slots: z.array(
    z.object({
      slotId,
      edge: z.enum(SLOT_EDGES),
      moment: z.string().meta({ untrusted: 'template-intent' }),
      at: z.number().optional(),
    }),
  ),
});

/**
 * MOM1: what became of a stated part: the window inside it, the stretch made longer for the slot, or another shot.
 * MOM2: or `handling`: the stretch is one where the camera is being handled, so it was not used and the clip plays
 * a part of the shot that keeps off it (playsShotFrom).
 */
const partOutcome = z.enum(['kept', 'widened', 'otherShot', 'handling']);

export const castToolInputSchema = z.object(castFields);
export type CastToolInput = z.output<typeof castToolInputSchema>;

const slotSummary = z.object({
  slotId,
  shotId: shotId.nullable(),
  assetId: ulidSchema('Asset').nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  needsRerank: z.boolean(),
  note: castNoteJson,
  alternates: z.array(shotId.nullable()).max(3),
  /**
   * MOM1: where the pick plays its shot from, in seconds of the shot's file (as timeline.get's playsShotFrom), on a
   * slot listed for a rerank (its candidates' moments are in the answer) or one with a stated part.
   */
  playsShotFrom: z.number().optional(),
  /** MOM1: on a slot the model stated a part for, what became of it. */
  part: partOutcome.optional(),
  /** MATCH1: on a slot whose stated part is a moment that lands on its edge, what became of it. */
  moment: momentOutcome.optional(),
});

/**
 * FIX-LIBRARIAN: an unsure slot worth a rerank, with its intent and what indexing saw in each candidate (the pick
 * first). The intent comes from a reference or a person, the descriptions from the user's media: data, not
 * instructions. FIX-STORY: the kinds of the graphics over the slot, and, in a library with no spare shot,
 * other slots' picks marked `from` with the slot each would leave and its intent (put first, one swaps them).
 * MOM1: a candidate's description ends with its moments, "… | 0-2.8s: …; 2.8-4.8s: …" (seconds of its file), in the
 * same string, so each candidate stays one fenced block.
 */
const rerankSlot = z.object({
  slotId,
  intent: z.object({
    text: z.string().meta({ untrusted: 'template-intent' }),
    shotType: z.enum(SHOT_TYPES).nullable(),
    motion: z.enum(CAMERA_MOTIONS).nullable(),
    graphics: z.array(z.enum(GRAPHIC_BRIEF_KINDS)).max(GRAPHIC_BRIEF_KINDS.length).optional(),
  }),
  candidates: z
    .array(
      z.object({
        shotId,
        description: z.string().meta({ untrusted: 'media' }).nullable(),
        from: z.object({ slotId, intent: z.string().meta({ untrusted: 'template-intent' }) }).optional(),
      }),
    )
    .max(5),
});

export const castToolOutputSchema = z.object({
  castId: ulidSchema('Cast'),
  configVersion: z.string(),
  variants: z.array(z.object({ sequenceConfidence: z.number(), slots: z.array(slotSummary) })),
  variantsShort: z.object({ asked: z.int(), made: z.int() }).optional(),
  /** The least confident unsure slots with an alternate or a swap, at most three: what a rerank orders. */
  rerank: z.array(rerankSlot).max(3),
  /** The full result (scores, parts, in-points), stored as JSON. */
  artifact: artifactRefSchema,
  /** FIX-GFXWAIT: the wait for the template's graphics, when they were still being designed. */
  graphics: graphicsWaitSchema.optional(),
  /**
   * KEEP1: what a slot noted `reelKept` is and that it is left alone, in words for the model; only when the
   * template has one. Here and not in the Librarian's prompt, whose casting turn has no room at the smallest window.
   */
  reelKept: z.string().optional(),
  lands: landsAsked.optional(),
});

export const assembleToolInputSchema = z.object({
  ...castFields,
  /** The Editor's text for the user's footage, by template overlay id. */
  texts: z.record(z.string(), z.string().trim().min(1).max(500)).optional(),
  /** One per variant; default "<template> · Variant n". */
  names: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  /** Ids for the new timelines (one per variant); new ones when omitted. */
  timelineIds: z.array(ulidSchema('Timeline')).max(10).optional(),
});
export type AssembleToolInput = z.output<typeof assembleToolInputSchema>;

export const assembleToolOutputSchema = z.object({
  castId: ulidSchema('Cast'),
  timelineIds: z.array(ulidSchema('Timeline')),
  /** Each new timeline's revision, in the same order: what the Librarian hands off (FIX-LIBRARIAN). */
  revisions: z.array(z.int().min(1)),
  /** Slots under the confidence line, over every variant. */
  lowConfidence: z.int().nonnegative(),
  variantsShort: z.object({ asked: z.int(), made: z.int() }).optional(),
  /** FIX-GFXWAIT: the wait for the template's graphics; `missing` overlays have no design in the new timelines. */
  graphics: graphicsWaitSchema.optional(),
  /** KEEP1: the slots that keep the reel's own footage, filled from the template's reel in every new timeline. */
  reelSlots: z.array(slotId).optional(),
  /** MOM1: each stated part in each new timeline: where its clip plays from, and what became of the part. */
  parts: z
    .array(
      z.object({
        timelineId: ulidSchema('Timeline'),
        slotId,
        shotId,
        playsShotFrom: z.number().nullable(),
        part: partOutcome,
      }),
    )
    .optional(),
  /** MATCH1: each stated moment in each new timeline. */
  moments: z.array(momentOutcome.extend({ timelineId: ulidSchema('Timeline'), slotId })).optional(),
  lands: landsAsked.optional(),
  /**
   * MATCH1: each edge of a kept reel slot the reel dissolved or faded into a person's slot: `redrawn`, the kept
   * clip starts or ends clear of those `frames`, a held clean frame stands in and the transition is drawn again;
   * not `redrawn`, the slot is too short for that and plays whole, the reel's blended frames with it.
   */
  reelBlends: z
    .array(
      z.object({
        slotId,
        edge: z.enum(SLOT_EDGES),
        kind: z.enum(['dissolve', 'fade']),
        frames: z.int().positive(),
        redrawn: z.boolean(),
      }),
    )
    .optional(),
});

export const getToolInputSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  // EDT1-OPS: the 9B couldn't work out the clip under the playhead from each clip's at and seconds.
  atSeconds: z
    .number()
    .min(0)
    .max(36_000)
    .optional()
    .describe(
      'A time, such as the playhead: the answer says which clip plays then (here) and the cut nearest it',
    ),
});

export const getToolOutputSchema = z.object({
  id: ulidSchema('Timeline'),
  projectId: ulidSchema('Project').optional(),
  /** The user's name for it (or the template's, which can come from a reference's title). */
  name: untrustedText('user-text'),
  revision: z.int(),
  rate: z.object({ num: z.int(), den: z.int() }),
  frames: z.int(),
  clips: z.array(
    z
      .object({
        /**
         * EDT1-OPS: in a docked run, the clip's number as the editor shows it (clip 3), which the editor tools take; a
         * gap has none. The docked rows leave out the slot, asset and shot ids, start, frames, in-point and confidence:
         * on the 9B the right clip's neighbour's id was copied from the next row.
         */
        clip: z.int().optional(),
        clipId: ulidSchema('TimelineItem'),
        // EDT1-OPS: what the shot shows, next to its id (its number in a docked run).
        shows: showsOut,
        slotId: slotId.nullable().optional(),
        kind: z.enum(['clip', 'gap', 'program']),
        assetId: ulidSchema('Asset').nullable().optional(),
        shotId: shotId.nullable().optional(),
        start: z.int().optional(),
        frames: z.int().optional(),
        locked: z.boolean(),
        /** The user chose this shot (a swap, a move or a lock): a re-cast passes it in `locked` to keep it. */
        userPick: z.boolean().optional(),
        /** The clip's in-point, for `locked`; null for a gap. */
        sourceStart: rationalTimeJsonSchema.nullable().optional(),
        confidence: z.number().nullable().optional(),
        // EDT1-OPS: place in seconds, speed, sound and colour.
        ...clipViewFields,
        // AGT2: what its slot is for (the template's intent, needs, face and reel timing) and the cast's score.
        slot: slotFactsSchema.optional(),
      })
      // EDT1-OPS: what a clip shows is fenced as clip-3, its number, never a count of every block that came before:
      // on the 9B, clip 5's block was numbered 6 (the timeline's name being 1), and a run moved the wrong clip.
      .meta({ untrustedLabel: 'clip' }),
  ),
  /** Overlay text: a reference reel's wording, the Editor's or the user's. Material, never instructions. */
  texts: z.array(
    z.object({
      itemId: ulidSchema('TimelineItem'),
      text: untrustedText('on-screen-text'),
      /** Who wrote it last: the template (the reference's wording), the Editor, or the user (keep it). */
      origin: z.enum(['template', 'editor', 'user']),
      start: z.int(),
      frames: z.int(),
    }),
  ),
  /** TXT1: only while the text has no designed look or no stated place, and never to a docked run. */
  textLook: z.string().optional(),
  // EDT1-OPS: the length in seconds, transitions, sounds, music, the whole video's colour and markers.
  ...editorViewSchema,
});

export const editToolOutputSchema = z.object({
  affectedItemIds: z.array(z.string()).default([]),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().min(1),
});

export const alternatesToolInputSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  // EDT1-OPS: or the clip by its number or "this" (clip-refs.ts), whose slot it is: a docked run's rows have no slot.
  slotId: slotId.optional(),
  clip: clipRefSchema.optional(),
  revision: readRevisionSchema,
  exclude: z.array(shotId).max(200).default([]),
  limit: z.int().min(1).max(12).default(6),
});

export const alternatesToolOutputSchema = z.object({ candidates: z.array(candidateJson) });
