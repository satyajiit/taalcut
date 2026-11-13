// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "What can I make with this footage?" (LRN1-TPL): casting's first step run for many templates against one pool of
 * shots, each template scored by how many of its slots distinct shots can fill above casting's floor, how well, and
 * how strong the opening is; ranked by coverage, then mean score. @taalcut/timeline computes it (`fitTemplates`);
 * the agent calls it as `timeline.fitTemplates`, the renderer through `timelines.fitTemplates`.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { MAX_TEMPLATE_TAGS, templateTagSchema } from '../templates/template-library';
import { SHOT_TYPES } from '../templates/template-parts';
import { templateSummarySchema } from '../templates/templates-contract';

/** The shots to fit: imports and folders (library sources), assets, and a capture window. At least one is given. */
export const fitPoolSchema = z
  .object({
    sourceIds: z.array(idSchema<'Source'>()).min(1).max(50).optional(),
    assetIds: z.array(idSchema<'Asset'>()).min(1).max(2000).optional(),
    /** Epoch ms, inclusive, on the capture time (the file's date without one). */
    capturedFrom: z.int().nonnegative().optional(),
    capturedTo: z.int().nonnegative().optional(),
  })
  .refine(
    (pool) =>
      pool.sourceIds !== undefined ||
      pool.assetIds !== undefined ||
      pool.capturedFrom !== undefined ||
      pool.capturedTo !== undefined,
    { message: 'Name the footage: sources, assets or a capture window' },
  );
export type FitPool = z.output<typeof fitPoolSchema>;

/** Which templates to fit; all listed, unarchived ones by default. A collection is passed as its templates' ids. */
export const fitTemplateScopeSchema = z.object({
  templateIds: z.array(idSchema<'Template'>()).min(1).max(500).optional(),
  folderId: idSchema<'TemplateFolder'>().optional(),
  tags: z.array(templateTagSchema).min(1).max(MAX_TEMPLATE_TAGS).optional(),
});
export type FitTemplateScope = z.output<typeof fitTemplateScopeSchema>;

export const fitTemplatesInputSchema = z.object({
  pool: fitPoolSchema,
  templates: fitTemplateScopeSchema.default({}),
  /** How many of the best fits come back (every template in scope is scored). */
  limit: z.int().min(1).max(50).default(10),
});
export type FitTemplatesInput = z.output<typeof fitTemplatesInputSchema>;

/**
 * Why a slot is weak: no usable shot at all (length, quality), only shots of another orientation (casting's relaxed
 * pass would crop them), or usable shots that better-fitting slots took (a shot fills one slot).
 */
export const FIT_WEAK_REASONS = ['noShot', 'orientation', 'taken'] as const;
export type FitWeakReason = (typeof FIT_WEAK_REASONS)[number];

export const fitWeakSlotSchema = z.object({
  slotId: idSchema<'TemplateSlot'>(),
  /** 0-based, in the head's order. */
  index: z.int().nonnegative(),
  /** What the slot wants, in words (casting's intent text): plain text, untrusted (it can echo a reference's words). */
  intent: z.string().max(500),
  shotType: z.enum(SHOT_TYPES).nullable(),
  reason: z.enum(FIT_WEAK_REASONS),
});
export type FitWeakSlot = z.output<typeof fitWeakSlotSchema>;

export const templateFitSchema = z.object({
  summary: templateSummarySchema,
  /** The head version fitted. */
  version: z.int().min(1),
  slots: z.int().min(1),
  /** Slots filled by distinct shots above casting's floor. */
  covered: z.int().nonnegative(),
  /** covered / slots. */
  coverage: z.number().min(0).max(1),
  /** Mean casting score (unary, the hook bonus on slot 0) of the filled slots; null when none is filled. */
  meanScore: z.number().nullable(),
  /** Casting's hook score of slot 0's shot, 0..1; null when slot 0 isn't filled. */
  hook: z.number().nullable(),
  /** Unfilled slots in slot order (at most 200). */
  weakSlots: z.array(fitWeakSlotSchema).max(200),
});
export type TemplateFit = z.output<typeof templateFitSchema>;

export const fitTemplatesResultSchema = z.object({
  /** Casting's config version, whose floor and weights scored it. */
  configVersion: z.string().min(1).max(64),
  /** Shots in the pool with a vector (shots not embedded yet can't be matched by meaning). */
  poolShots: z.int().nonnegative(),
  /** True when the pool had more shots than fit reads (2,000): the oldest captures were read. */
  poolTruncated: z.boolean(),
  /** Templates scored. */
  templates: z.int().nonnegative(),
  /** Best first: coverage, then mean score, then hook, then template id. */
  fits: z.array(templateFitSchema).max(50),
});
export type FitTemplatesResult = z.output<typeof fitTemplatesResultSchema>;
