// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: the Editor's `graphics.design`. Every change to a graphic's look, and every new graphic, is a job for the
 * Designer (render's `render.designer` skill): the Editor records the person's request as they said it, what it is
 * about (graphics already on the timeline, or where a new one comes on) and the comment it answers, and the
 * Designer's step after the Editor's does the design, places it as a proposal and replies. Model-facing, so the
 * schema converts to JSON Schema (ulidSchema, seconds as numbers).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ulidSchema } from '../basics/ids';
import { GRAPHIC_REQUEST_MAX } from './graphic-proposal';
import { editTargetJsonSchema } from './edit-target';

export const GRAPHICS_DESIGN_TOOL = 'graphics.design';

/** The most graphics one job redesigns together (a conversation's bubbles). */
export const DESIGN_JOB_MAX_ITEMS = 24;

export const graphicsDesignJobSchema = z
  .object({
    /** The person's words, verbatim: untrusted, handed to the Designer as data. */
    request: z.string().trim().min(1).max(GRAPHIC_REQUEST_MAX),
    /** Graphics already on the timeline the job redesigns; absent for a new graphic. */
    itemIds: z.array(ulidSchema('TimelineItem')).min(1).max(DESIGN_JOB_MAX_ITEMS).optional(),
    /** A new graphic: seconds from the start of the video it comes on at. */
    at: z.number().min(0).max(3600).optional(),
    /** A new graphic: words someone says, to come on with them. */
    phrase: z.string().trim().min(1).max(80).optional(),
    /** A new graphic: what the person pointed at (an editor chip's target, a stretch of the video). */
    target: editTargetJsonSchema.optional(),
    /** The comment the job answers: the Designer replies to it. */
    commentId: ulidSchema('TimelineComment').optional(),
  })
  .refine(
    (job) =>
      [job.at, job.phrase, job.target?.kind === 'timeline' ? undefined : job.target].filter(
        (where) => where !== undefined,
      ).length <= 1,
    {
      message: 'Say where with one of at, phrase or target',
      path: ['at'],
    },
  );
export type GraphicsDesignJob = z.output<typeof graphicsDesignJobSchema>;
