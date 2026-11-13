// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The `graphics` tools' inputs and outputs as the model writes and reads them (tools.ts). */
import { z } from 'zod';
import {
  graphicParamValuesSchema,
  graphicPlacementSchema,
  rationalTimeJsonSchema,
  ulidSchema,
} from '@taalcut/core';

export const revision = z.int().positive();
const target = { projectId: ulidSchema('Project'), timelineId: ulidSchema('Timeline'), revision };

/**
 * Core's anchor with its time as a model writes it (a frame rate's schema reduces the rate, which JSON Schema
 * can't say); the bus validates the dispatched payload with core's own schema again.
 */
const anchorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('phrase'),
    text: z.string().trim().min(1).max(80),
    occurrence: z.int().min(1).max(20),
  }),
  z.object({ kind: z.literal('slot'), slotId: ulidSchema('TemplateSlot') }),
  z.object({ kind: z.literal('time'), at: rationalTimeJsonSchema }),
]);

/** A move or a resize a model asks of a graphic: refused, since a design places and sizes itself (tools.ts). */
const placeWords = {
  move: z
    .object({ direction: z.enum(['up', 'down', 'left', 'right']), amount: z.enum(['little', 'lot']) })
    .optional(),
  resize: z.enum(['smaller', 'larger']).optional(),
  placement: graphicPlacementSchema.optional(),
  scale: z.number().optional(),
};

export const editInput = z.object({
  ...target,
  itemId: ulidSchema('TimelineItem'),
  anchor: anchorSchema.optional(),
  /** The model's edge: whole milliseconds, dispatched as core's `duration` (media time, exact). */
  durationMs: z.int().min(500).max(600_000).optional(),
  /** Its design's variables by name (graphics.list's `composition.variables`): its words and colours. */
  params: graphicParamValuesSchema.optional(),
  ...placeWords,
});

export const removeInput = z.object({
  ...target,
  itemId: ulidSchema('TimelineItem').optional().describe('Single graphic or text overlay itemId to remove'),
  itemIds: z
    .array(ulidSchema('TimelineItem'))
    .min(1)
    .max(50)
    .optional()
    .describe('Batch removal: multiple graphic or text overlay itemIds to remove in one call'),
});

export const useProposalInput = z.object({ ...target, itemId: ulidSchema('TimelineItem') });

export const receiptSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  affectedItemIds: z.array(ulidSchema('TimelineItem')),
  itemId: ulidSchema('TimelineItem'),
  revision,
  start: rationalTimeJsonSchema,
  unmatched: z.array(z.string()),
});

export const itemSchema = z.object({
  itemId: ulidSchema('TimelineItem'),
  /**
   * The composition it is drawn with: its words and colours are its variables (graphics.edit's params), its look is
   * the Designer's (graphics.design).
   */
  composition: z.object({
    id: ulidSchema('GraphicComposition'),
    version: z.int().positive(),
    name: z.string().meta({ untrusted: 'composition-name' }),
    variables: z.array(z.object({ name: z.string(), type: z.string() })),
    params: graphicParamValuesSchema,
  }),
  start: rationalTimeJsonSchema,
  duration: rationalTimeJsonSchema,
  placement: graphicPlacementSchema,
  origin: z.enum(['agent', 'user']),
  /** EDT1-GFX: still a proposal the person hasn't used (not in the video yet). */
  proposal: z.object({ design: z.string() }).optional(),
});
