// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `timeline.fitTemplates` (LRN1-TPL): which of the user's templates their footage can make, best first, and what
 * each is short of. A read: casting's first step for every template against one pool, nothing changes. The input is
 * checked again with core's `fitTemplatesInputSchema` (a pool needs sources, assets or a capture window).
 */
import {
  defineTool,
  err,
  FIT_WEAK_REASONS,
  fitTemplatesInputSchema,
  NO_TOOL_RETRY,
  ok,
  SHOT_TYPES,
  ulidSchema,
  ValidationError,
  type AnyTool,
  type FitTemplatesResult,
} from '@taalcut/core';
import { z } from 'zod';
import type { TemplateFitter } from '../fit/fit-templates';
import { toolKey } from './hash';

const untrustedText = (source: 'user-text' | 'template-intent') => z.string().meta({ untrusted: source });

export const fitToolInputSchema = z.object({
  pool: z.object({
    /** Imports and folders (library sources). */
    sourceIds: z.array(ulidSchema('Source')).min(1).max(50).optional(),
    assetIds: z.array(ulidSchema('Asset')).min(1).max(2000).optional(),
    capturedFrom: z.int().nonnegative().optional().describe('Epoch ms, inclusive, on capture time'),
    capturedTo: z.int().nonnegative().optional().describe('Epoch ms, inclusive, on capture time'),
  }),
  templates: z
    .object({
      templateIds: z.array(ulidSchema('Template')).min(1).max(500).optional(),
      folderId: ulidSchema('TemplateFolder').optional(),
      tags: z.array(z.string().min(1).max(32)).min(1).max(12).optional(),
    })
    .optional(),
  limit: z.int().min(1).max(50).default(5),
});
export type FitToolInput = z.output<typeof fitToolInputSchema>;

const weakSlotOutput = z.object({
  slotId: ulidSchema('TemplateSlot'),
  index: z.int().nonnegative(),
  intent: untrustedText('template-intent'),
  shotType: z.enum(SHOT_TYPES).nullable(),
  reason: z.enum(FIT_WEAK_REASONS),
});

export const fitToolOutputSchema = z.object({
  configVersion: z.string(),
  poolShots: z.int().nonnegative(),
  poolTruncated: z.boolean(),
  templates: z.int().nonnegative(),
  fits: z.array(
    z.object({
      templateId: ulidSchema('Template'),
      version: z.int().min(1),
      /** The template's name: the user's, or a reference's title. */
      name: untrustedText('user-text'),
      slots: z.int().min(1),
      covered: z.int().nonnegative(),
      coverage: z.number().min(0).max(1),
      meanScore: z.number().nullable(),
      hook: z.number().nullable(),
      weakSlots: z.array(weakSlotOutput),
    }),
  ),
});

function answer(result: FitTemplatesResult): z.input<typeof fitToolOutputSchema> {
  return {
    configVersion: result.configVersion,
    poolShots: result.poolShots,
    poolTruncated: result.poolTruncated,
    templates: result.templates,
    fits: result.fits.map((fit) => ({
      templateId: fit.summary.id,
      version: fit.version,
      name: fit.summary.name,
      slots: fit.slots,
      covered: fit.covered,
      coverage: fit.coverage,
      meanScore: fit.meanScore,
      hook: fit.hook,
      weakSlots: fit.weakSlots.map((slot) => ({ ...slot })),
    })),
  };
}

/** What the model reads when the pool names no footage: why, and what to pass instead. */
export const EMPTY_POOL =
  'That pool has no shots: none of its ids or its capture window names indexed footage, so nothing was fitted ' +
  "(this says nothing about how the user's footage fits). sourceIds are imports or folders, not asset ids; pass " +
  'clips in assetIds. Footage that is still being indexed has no shots yet.';

function summarize(output: z.output<typeof fitToolOutputSchema>): string {
  const best = output.fits[0];
  if (!best) return `No template to fit (${output.poolShots} shots in the pool).`;
  return (
    `${output.templates} templates fitted to ${output.poolShots} shots; the best fills ` +
    `${best.covered} of ${best.slots} slots.`
  );
}

export function fitTools(fitter: TemplateFitter | undefined): AnyTool[] {
  if (!fitter) return [];
  const tool = defineTool({
    name: 'timeline.fitTemplates',
    version: '1.1.0',
    description:
      "Ranks the user's templates by how well a pool of their footage (an import or folder by source id, some " +
      'assets, or a capture window) fills them: per template the share of slots distinct shots can fill above ' +
      "casting's floor, the mean casting score, the hook strength, and the slots it is short of with what each " +
      'wants. Best first. Use it when the user has footage and no template ("what can I make with this?"); then ' +
      'cast the chosen template with timeline.cast. Changes nothing.',
    summary: "Ranks templates by how well the user's footage fills them, with what each is missing.",
    tags: ['casting', 'templates', 'fit', 'footage', 'recommend'],
    input: fitToolInputSchema,
    output: fitToolOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 60_000,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (input) => toolKey('timeline.fitTemplates', input),
    permission: { filesystem: { read: ['library'] } },
    summarize,
    run: async (input, ctx) => {
      const parsed = fitTemplatesInputSchema.safeParse({
        pool: input.pool,
        templates: input.templates ?? {},
        limit: input.limit,
      });
      if (!parsed.success)
        return err(ValidationError({ field: 'pool' }, { detail: parsed.error.issues[0]?.message ?? '' }));
      const fitted = await fitter.fitTemplates(parsed.data, ctx.signal);
      if (!fitted.ok) return fitted;
      // BRK1-MAKE: a pool that names no indexed footage is no fit of 0. On the owner's paste the Librarian passed an
      // asset id as a source id, read "coverage 0" as footage that doesn't match, and planned a generic video.
      if (fitted.value.poolShots === 0)
        return err(ValidationError({ field: 'pool' }, { detail: EMPTY_POOL }));
      return ok(answer(fitted.value));
    },
  });
  return [tool as AnyTool];
}
