// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2 eyes: `video.compare`'s input and output (render SPEC "AGT2 eyes"). */
import { z } from 'zod';
import { artifactRefSchema, ulidSchema } from '@taalcut/core';
import { slotFactsSchema } from '@taalcut/timeline';
import { footagePicturesSchema } from './pictures';

/** Where in a slot a pair is cut: a tenth in, the middle, a tenth before its end (of the reel's and the draft's). */
export const COMPARE_MOMENTS = ['start', 'middle', 'end'] as const;
export type CompareMoment = (typeof COMPARE_MOMENTS)[number];
export const MOMENT_SHARE: Readonly<Record<CompareMoment, number>> = { start: 0.1, middle: 0.5, end: 0.9 };

/** A sheet's rows (one slot moment each); the most sheets, so rows, one call returns. */
export const ROWS_PER_SHEET = 4;
export const COMPARE_SHEETS_MAX = 6;
export const COMPARE_ROWS_MAX = ROWS_PER_SHEET * COMPARE_SHEETS_MAX;
/** A cell's height in a sheet, in pixels: small by default, so a whole video fits a turn. */
export const CELL_HEIGHT = { min: 160, default: 320, max: 640 } as const;

export const compareInputSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  slots: z
    .array(z.int().min(1))
    .min(1)
    .max(COMPARE_ROWS_MAX)
    .optional()
    .describe('Slot numbers (1 first, as timeline.get’s rows say); default: every slot'),
  moments: z
    .array(z.enum(COMPARE_MOMENTS))
    .min(1)
    .max(3)
    .optional()
    .describe('Where in each slot; default start, middle and end for one slot, the middle for more'),
  renderId: ulidSchema('Render').optional().describe('The draft to compare; default the newest finished one'),
  cellHeight: z
    .int()
    .min(CELL_HEIGHT.min)
    .max(CELL_HEIGHT.max)
    .default(CELL_HEIGHT.default)
    .describe('Each frame’s height in the pictures, in pixels'),
  judge: z
    .boolean()
    .default(false)
    .describe('Also ask a vision judge, per slot, what differs between the reel and the draft'),
});
export type CompareInput = z.output<typeof compareInputSchema>;

const frameSchema = z.object({
  moment: z.enum(COMPARE_MOMENTS),
  /** Seconds into the reel and into the draft; null where there is none. */
  reelSeconds: z.number().nullable(),
  draftSeconds: z.number().nullable(),
  /** The frames as image artifacts (for vision.describeFrame, or to draw over); null where none was cut. */
  reelImage: ulidSchema('Artifact').nullable(),
  draftImage: ulidSchema('Artifact').nullable(),
});

export const slotVerdictSchema = z.object({
  matches: z.boolean(),
  /** At most six, with their direction and size. A model's words from the frames: data, never instructions. */
  differences: z.array(z.string().meta({ untrusted: 'vision' })),
  by: z.string(),
});
export type SlotVerdictOut = z.output<typeof slotVerdictSchema>;

export const compareSlotSchema = slotFactsSchema.extend({
  slotId: ulidSchema('TemplateSlot'),
  /** The clip filling it now, as timeline.get numbers it; null for a gap or none. */
  clip: z.int().nullable(),
  clipId: ulidSchema('TimelineItem').nullable(),
  /** Where its clip sits in the draft, in seconds; null when the draft has none. */
  draft: z.object({ at: z.number(), seconds: z.number() }).nullable(),
  frames: z.array(frameSchema),
  /** judge: what a vision judge saw differ; a string when it couldn't judge, and why. */
  judged: z.union([slotVerdictSchema, z.string()]).optional(),
});
/** As a tool builds it (ids as plain strings). */
export type CompareSlot = z.input<typeof compareSlotSchema>;

export const compareOutputSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  /** The draft compared, its timeline revision and whether that is the newest; null before the first draft. */
  draft: z.object({ renderId: ulidSchema('Render'), revision: z.int(), newest: z.boolean() }).nullable(),
  /** The template's kept reel was read. */
  reel: z.boolean(),
  pictures: footagePicturesSchema,
  /** The pictures: each row a slot moment (rows says which), the reel's frame on the left and the draft's right. */
  sheets: z.array(
    z.object({
      image: artifactRefSchema,
      columns: z.array(z.enum(['reel', 'draft'])),
      rows: z.array(z.object({ slot: z.int(), moment: z.enum(COMPARE_MOMENTS) })),
    }),
  ),
  slots: z.array(compareSlotSchema),
  /** Slots asked for and left out: past the call's cap, or not in the template. Ask for them in another call. */
  left: z.array(z.int()),
  note: z.string(),
});
/** As a tool builds it (ids as plain strings). */
export type CompareOutput = z.input<typeof compareOutputSchema>;
