// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Graphics on a timeline (P3-V13, HFW1): each is a HyperFrames composition the AI designed (a copy in the timeline's
 * `graphicCompositions`) with its variables' values, on a text track beside text items (Timeline v2), anchored to a
 * phrase someone says, a slot or a time. Render draws them (render SPEC "HFW1") and the GRAPHICS_COMMANDS edit them.
 * HFW1 retire: the hand-built kit (its kinds, fields, look and motion) and DSG1's components are gone.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { boxSchema, languageTagSchema, styleKeySchema } from '../templates/template-parts';
import { graphicCompositionRefSchema } from '../workspace/composition-ref';
import { rationalTimeSchema } from '../time/rational-time';
import { graphicProposalSchema, graphicScaleSchema } from './graphic-proposal';
import { PLACEMENT_REASONS } from './made-placement';

/** What a graphic is pinned to; render resolves it to a time and rewrites `start` when it moves. */
export const graphicAnchorSchema = z.discriminatedUnion('kind', [
  /** Words someone says ("fifty percent"), matched against the caption words. Untrusted text. */
  z.object({
    kind: z.literal('phrase'),
    text: z.string().trim().min(1).max(80),
    occurrence: z.int().min(1).max(20),
  }),
  z.object({ kind: z.literal('slot'), slotId: idSchema<'TemplateSlot'>() }),
  z.object({ kind: z.literal('time'), at: rationalTimeSchema }),
]);
export type GraphicAnchor = z.output<typeof graphicAnchorSchema>;

export const GRAPHIC_PLACEMENTS = ['top', 'middle', 'bottom'] as const;
/** A box: FRM1-OVL's solver records why it chose it (`reason`); without one it is a box someone set. */
export const graphicPlacementSchema = z.union([
  z.enum(GRAPHIC_PLACEMENTS),
  z.object({ box: boxSchema, reason: z.enum(PLACEMENT_REASONS).optional() }),
]);

/** A graphic on a text track: a composition the AI designed, where and when it shows. */
export const graphicItemSchema = z.object({
  type: z.literal('graphic'),
  id: idSchema<'TimelineItem'>(),
  anchor: graphicAnchorSchema,
  /** Resolved from the anchor, at the canvas rate. */
  start: rationalTimeSchema,
  duration: rationalTimeSchema,
  placement: graphicPlacementSchema,
  styleKey: styleKeySchema,
  language: languageTagSchema.nullable(),
  origin: z.enum(['agent', 'user']),
  /**
   * BRK1-GFX: the template overlay this graphic draws (a reel's chat bubble, pill or sticker), and whose words it
   * shows now, as a text item's `origin`: the reel's, the Editor's or the person's.
   */
  overlay: z
    .object({ id: idSchema<'TextOverlay'>(), words: z.enum(['template', 'editor', 'user']) })
    .optional(),
  /**
   * EDT1-GFX: a graphic the chat created and the person hasn't used yet (graphic-proposal.ts): the preview draws
   * it, an export and QA leave it out until `graphics.useProposal`.
   */
  proposal: graphicProposalSchema.optional(),
  /** EDT1-GFX: its size against the composition's own (absent: 1). */
  scale: graphicScaleSchema.optional(),
  /** HFW1: the composition it is drawn with (a copy in the timeline's `graphicCompositions`) and its values. */
  composition: graphicCompositionRefSchema,
});
export type GraphicItem = z.output<typeof graphicItemSchema>;
