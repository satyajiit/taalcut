// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2: the designs a person chooses between. The Designer makes up to three for a job, one at a time
 * (`graphics.placeOptions`: the first starts the set, and `join` adds each later one), each a composition of its own
 * with the same words and time. The first is in the video at once (no proposal: the preview, an export and QA all
 * draw it), and the graphic keeps the set so the person can swap another in (`graphics.chooseOption`, one undo) or
 * ask for three new ones. When a job covers several graphics (a lyric's words,
 * a set of labels) they share one set (`set`) and change together: an option is one look for all of them.
 *
 * The one in use is the option whose composition the graphic is drawn with (`optionInUse`), so a later version of
 * that design (`graphics.setComposition`) stays the chosen one.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { sha256Schema } from '../templates/template-parts';
import { WORKSPACE_LIMITS } from '../workspace/workspace-files';
import { GRAPHIC_REQUEST_MAX } from './graphic-proposal';

/** How many designs a job comes with. */
export const GRAPHIC_OPTION_COUNT = 3;

/** The longest an option's idea is (one line in the designing model's words). */
export const GRAPHIC_OPTION_IDEA_MAX = 160;

/**
 * The largest still an option keeps, in bytes: what a workspace file holds, since the still is kept with the
 * workspace's files (a JPEG or PNG at the size of a tile, not of the viewer).
 */
export const GRAPHIC_OPTION_STILL_BYTES = WORKSPACE_LIMITS.fileBytes;

export const GRAPHIC_OPTION_STILL_TYPES = ['image/jpeg', 'image/png'] as const;

/** A still of an option drawn over the footage, kept with the workspace's files (read by its sha256). */
export const graphicOptionStillSchema = z.object({
  sha256: sha256Schema,
  bytes: z.int().positive().max(GRAPHIC_OPTION_STILL_BYTES),
  mimeType: z.enum(GRAPHIC_OPTION_STILL_TYPES),
});
export type GraphicOptionStill = z.output<typeof graphicOptionStillSchema>;

/** One design of a set: its composition (a copy in the timeline's `graphicCompositions`) and what it is going for. */
export const graphicOptionSchema = z.object({
  compositionId: idSchema<'GraphicComposition'>(),
  /** The point of view behind it, in the designing model's words. Untrusted, shown as plain text only. */
  idea: z.string().trim().min(1).max(GRAPHIC_OPTION_IDEA_MAX),
  still: graphicOptionStillSchema.optional(),
});
export type GraphicOption = z.output<typeof graphicOptionSchema>;

/**
 * The set a graphic was placed with: one to three designs, each composition once. It starts with the first design
 * placed (in use at once) and grows as each later one is ready; one design is nothing to choose between yet.
 */
export const graphicOptionsSchema = z
  .object({
    /** Shared by every graphic designed together: choosing changes them all. */
    set: idSchema<'GraphicOptionSet'>(),
    /** The person's words the set was designed from. Untrusted, shown as plain text only. */
    request: z.string().trim().min(1).max(GRAPHIC_REQUEST_MAX),
    createdAt: z.int().nonnegative(),
    designs: z.array(graphicOptionSchema).min(1).max(GRAPHIC_OPTION_COUNT),
  })
  .refine(
    (options) =>
      new Set(options.designs.map((design) => design.compositionId)).size === options.designs.length,
    {
      message: 'Each design once',
      path: ['designs'],
    },
  );
export type GraphicOptions = z.output<typeof graphicOptionsSchema>;

/** The option a graphic is drawn with now (by its composition's id), or undefined when it is none of them. */
export function optionInUse(item: {
  readonly composition: { readonly id: string };
  readonly options?: GraphicOptions | undefined;
}): GraphicOption | undefined {
  return item.options?.designs.find((design) => design.compositionId === item.composition.id);
}
