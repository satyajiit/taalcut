// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-GFX, HFW1: a graphic the Designer made (`graphics.placeComposition`) that the person hasn't used yet. It sits
 * on a text track like any graphic, so the preview draws it, the bed shows it, and graphics.edit, graphics.design and
 * graphics.remove change it; an export and QA leave it out until `graphics.useProposal` keeps it. Its record keeps
 * the person's words it was made from. HFW1 retire: a proposal is always a design of its own (no kit design, no kit
 * reason).
 */
import '../basics/zod-config';
import { z } from 'zod';

/** How a proposed graphic is drawn: a composition designed for it. */
export const GRAPHIC_PROPOSAL_DESIGNS = ['designed'] as const;
export type GraphicProposalDesign = (typeof GRAPHIC_PROPOSAL_DESIGNS)[number];

/** The longest request a proposal keeps (the person's words, as for a restyle). */
export const GRAPHIC_REQUEST_MAX = 500;

export const graphicProposalSchema = z.object({
  /** The person's words it was created from. Untrusted, shown as plain text only. */
  request: z.string().trim().min(1).max(GRAPHIC_REQUEST_MAX),
  design: z.enum(GRAPHIC_PROPOSAL_DESIGNS),
  createdAt: z.int().nonnegative(),
});
export type GraphicProposal = z.output<typeof graphicProposalSchema>;

/** A graphic's size against its composition's own (1): the whole graphic, its type with it. */
export const GRAPHIC_SCALE_LIMITS = { min: 0.5, max: 2 } as const;
export const graphicScaleSchema = z.number().min(GRAPHIC_SCALE_LIMITS.min).max(GRAPHIC_SCALE_LIMITS.max);
